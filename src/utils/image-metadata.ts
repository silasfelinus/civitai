import { FileWithPath } from '@mantine/dropzone';
import exifr from 'exifr';
import { unescape } from 'lodash';
import { ImageMetaProps, imageMetaSchema } from '~/server/schema/image.schema';
import blocked from './blocklist.json';

export async function getMetadata(file: FileWithPath) {
  let exif: any; //eslint-disable-line
  try {
    exif = await exifr.parse(file, {
      userComment: true,
    });
  } catch (e: any) { //eslint-disable-line
    return {};
  }
  let generationDetails = null;
  if (exif?.userComment) {
    const p = document.createElement('p');
    generationDetails = decoder.decode(exif.userComment);
    // Any annoying hack to deal with weirdness in the meta
    p.innerHTML = generationDetails;
    p.remove();
    generationDetails = p.innerHTML;
  } else if (exif?.parameters) {
    generationDetails = exif.parameters;
  }

  const metadata = parseMetadata(generationDetails);
  const result = imageMetaSchema.safeParse(metadata);
  return result.success ? result.data : {};
}

// #region [infra]
function parseMetadata(meta: string): Record<string, unknown> {
  if (!meta) return {};
  meta = meta.replace('UNICODE', '').replace(/�/g, '');
  meta = unescape(meta);
  const { parse } = parsers.find((x) => x.canHandle(meta)) ?? {};
  if (!parse) return {};

  return parse(meta);
}

type MetadataParser = {
  canHandle: (meta: string) => boolean;
  parse: (meta: string) => ImageMetaProps;
};

function createMetadataParser(
  canHandle: MetadataParser['canHandle'],
  parse: MetadataParser['parse']
): MetadataParser {
  return {
    canHandle,
    parse,
  };
}

const decoder = new TextDecoder('utf-8');
// #endregion

// #region [parsers]
const automaticExtraNetsRegex = /<(lora|hypernet):([a-zA-Z0-9_\.]+):([0-9.]+)>/g;
const automaticNameHash = /([a-zA-Z0-9_\.]+)\(([a-zA-Z0-9]+)\)/;
const automaticSDKeyMap = new Map<string, keyof ImageMetaProps>([
  ['Seed', 'seed'],
  ['CFG scale', 'cfgScale'],
  ['Sampler', 'sampler'],
  ['Steps', 'steps'],
]);
const automaticSDParser = createMetadataParser(
  (meta: string) => meta.includes('Steps: '),
  (meta: string) => {
    const metadata: ImageMetaProps = {};
    if (!meta) return metadata;
    const metaLines = meta.split('\n');
    const fineDetails =
      metaLines
        .pop()
        ?.split(',')
        .map((x) => x.split(':')) ?? [];
    for (const [k, v] of fineDetails) {
      if (!v) continue;
      const propKey = automaticSDKeyMap.get(k.trim()) ?? k.trim();
      metadata[propKey] = v.trim();
    }

    // Extract prompts
    const [prompt, negativePrompt] = metaLines
      .join('\n')
      .split('Negative prompt:')
      .map((x) => x.trim());
    metadata.prompt = prompt;
    metadata.negativePrompt = negativePrompt;

    // Extract resources
    const extranets = [...prompt.matchAll(automaticExtraNetsRegex)];
    const resources: SDResource[] = extranets.map(([, type, name, weight]) => ({
      type,
      name,
      weight: parseFloat(weight),
    }));

    if (metadata['Model'] && metadata['Model hash'])
      resources.push({
        type: 'model',
        name: metadata['Model'] as string,
        hash: metadata['Model hash'] as string,
      });

    if (metadata['Hypernet'] && metadata['Hypernet strength'])
      resources.push({
        type: 'hypernet',
        name: metadata['Hypernet'] as string,
        weight: parseFloat(metadata['Hypernet strength'] as string),
      });

    if (metadata['AddNet Enabled'] === 'True') {
      let i = 1;
      while (true) {
        const fullname = metadata[`AddNet Model ${i}`] as string;
        if (!fullname) break;
        const [, name, hash] = fullname.match(automaticNameHash) ?? [];

        resources.push({
          type: (metadata[`AddNet Module ${i}`] as string).toLowerCase(),
          name,
          hash,
          weight: parseFloat(metadata[`AddNet Weight ${i}`] as string),
        });
        i++;
      }
    }

    metadata.resources = resources;

    return metadata;
  }
);
const parsers = [automaticSDParser];

type SDResource = {
  type: string;
  name: string;
  weight?: number;
  hash?: string;
};
// #endregion

// #region [encoders]
export function encodeMetadata(
  metadata: ImageMetaProps,
  encoder: keyof typeof encoders = 'automatic1111'
) {
  return encoders[encoder](metadata);
}

const automaticSDEncodeMap = new Map<keyof ImageMetaProps, string>(
  Array.from(automaticSDKeyMap, (a) => a.reverse()) as Iterable<readonly [string, string]>
);
function automaticEncoder({ prompt, negativePrompt, resources, ...other }: ImageMetaProps) {
  const lines = [prompt];
  if (negativePrompt) lines.push(`Negative prompt: ${negativePrompt}`);
  const fineDetails = [];
  for (const [k, v] of Object.entries(other)) {
    const key = automaticSDEncodeMap.get(k) ?? k;
    fineDetails.push(`${key}: ${v}`);
  }
  if (fineDetails.length > 0) lines.push(fineDetails.join(', '));

  return lines.join('\n');
}

const encoders = {
  automatic1111: automaticEncoder,
};
// #endregion

// #region [audit]
const blockedRegex = blocked.map((word) => ({
  word,
  regex: new RegExp(`(^|\\s|\\(|\\))${word}(\\s|,|$|\\(|\\))`, 'm'),
}));
export const auditMetaData = (meta: AsyncReturnType<typeof getMetadata>) => {
  const blockedFor = blockedRegex
    .filter(({ regex }) => meta?.prompt && regex.test(meta.prompt))
    .map((x) => x.word);
  return { blockedFor, success: !blockedFor.length };
};
// #endregion
