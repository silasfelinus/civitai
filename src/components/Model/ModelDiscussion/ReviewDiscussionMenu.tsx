import { ActionIcon, MantineNumberSize, Menu, MenuProps, Text } from '@mantine/core';
import { closeAllModals, openConfirmModal } from '@mantine/modals';
import {
  IconDotsVertical,
  IconTrash,
  IconEdit,
  IconCalculatorOff,
  IconSwitchHorizontal,
  IconCalculator,
  IconFlag,
} from '@tabler/icons';
import { SessionUser } from 'next-auth';

import { LoginRedirect } from '~/components/LoginRedirect/LoginRedirect';
import { useRoutedContext } from '~/routed-context/routed-context.provider';
import { ReportEntity } from '~/server/schema/report.schema';
import { ReviewGetAllItem } from '~/types/router';
import { showErrorNotification } from '~/utils/notifications';
import { trpc } from '~/utils/trpc';

export function ReviewDiscussionMenu({
  review,
  user,
  size = 'xs',
  replaceNavigation = false,
  ...props
}: Props) {
  const { openContext, closeContext } = useRoutedContext();
  const queryUtils = trpc.useContext();

  const isMod = user?.isModerator ?? false;
  const isOwner = review.user.id === user?.id;

  const deleteMutation = trpc.review.delete.useMutation({
    async onSuccess() {
      await queryUtils.review.getAll.invalidate();
      closeAllModals();
      closeContext();
    },
    onError(error) {
      showErrorNotification({
        error: new Error(error.message),
        title: 'Could not delete review',
      });
    },
  });
  const handleDeleteReview = () => {
    openConfirmModal({
      title: 'Delete Review',
      children: (
        <Text size="sm">
          Are you sure you want to delete this review? This action is destructive and cannot be
          reverted.
        </Text>
      ),
      centered: true,
      labels: { confirm: 'Delete Review', cancel: "No, don't delete it" },
      confirmProps: { color: 'red', loading: deleteMutation.isLoading },
      closeOnConfirm: false,
      onConfirm: () => {
        deleteMutation.mutate({ id: review.id });
      },
    });
  };

  const excludeMutation = trpc.review.toggleExclude.useMutation({
    async onSuccess() {
      await queryUtils.review.getAll.invalidate();
      closeAllModals();
    },
    onError(error) {
      showErrorNotification({
        error: new Error(error.message),
        title: 'Could not exclude review',
      });
    },
  });
  const handleExcludeReview = () => {
    openConfirmModal({
      title: 'Exclude Review',
      children: (
        <Text size="sm">
          Are you sure you want to exclude this review from the average score of this model? You
          will not be able to revert this.
        </Text>
      ),
      centered: true,
      labels: { confirm: 'Exclude Review', cancel: "No, don't exclude it" },
      confirmProps: { color: 'red', loading: deleteMutation.isLoading },
      closeOnConfirm: false,
      onConfirm: () => {
        excludeMutation.mutate({ id: review.id });
      },
    });
  };
  const handleUnexcludeReview = () => {
    excludeMutation.mutate({ id: review.id });
  };

  const convertToCommentMutation = trpc.review.convertToComment.useMutation({
    async onSuccess() {
      await queryUtils.review.getAll.invalidate();
      await queryUtils.comment.getAll.invalidate();
      closeContext();
    },
    onError(error) {
      showErrorNotification({
        error: new Error(error.message),
      });
    },
    onSettled() {
      closeAllModals();
    },
  });
  const handleConvertToComment = () => {
    openConfirmModal({
      title: 'Convert to Review',
      children: (
        <Text size="sm">
          Are you sure you want to convert this review to a comment? You will not be able to revert
          this.
        </Text>
      ),
      centered: true,
      labels: { confirm: 'Convert', cancel: 'Cancel' },
      confirmProps: { loading: convertToCommentMutation.isLoading },
      closeOnConfirm: false,
      onConfirm: () => {
        convertToCommentMutation.mutate({ id: review.id });
      },
    });
  };

  return (
    <Menu position="bottom-end" withinPortal {...props}>
      <Menu.Target>
        <ActionIcon size={size} variant="subtle">
          <IconDotsVertical size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {(isOwner || isMod) && (
          <>
            <Menu.Item
              icon={<IconTrash size={14} stroke={1.5} />}
              color="red"
              onClick={handleDeleteReview}
            >
              Delete review
            </Menu.Item>
            <Menu.Item
              icon={<IconEdit size={14} stroke={1.5} />}
              onClick={() =>
                openContext('reviewEdit', { reviewId: review.id }, { replace: replaceNavigation })
              }
            >
              Edit review
            </Menu.Item>
            {!review.exclude && (
              <Menu.Item
                icon={<IconCalculatorOff size={14} stroke={1.5} />}
                onClick={handleExcludeReview}
              >
                Exclude from average
              </Menu.Item>
            )}
            {isMod && (
              <Menu.Item
                icon={<IconSwitchHorizontal size={14} stroke={1.5} />}
                onClick={handleConvertToComment}
              >
                Convert to comment
              </Menu.Item>
            )}
            {isMod && review.exclude && (
              <Menu.Item
                icon={<IconCalculator size={14} stroke={1.5} />}
                onClick={handleUnexcludeReview}
              >
                Unexclude from average
              </Menu.Item>
            )}
          </>
        )}
        {(!user || !isOwner) && (
          <LoginRedirect reason="report-model">
            <Menu.Item
              icon={<IconFlag size={14} stroke={1.5} />}
              onClick={() =>
                openContext(
                  'report',
                  { type: ReportEntity.Review, entityId: review.id },
                  { replace: replaceNavigation }
                )
              }
            >
              Report
            </Menu.Item>
          </LoginRedirect>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

type Props = MenuProps & {
  review: Pick<ReviewGetAllItem, 'id' | 'exclude' | 'user'>;
  user?: SessionUser | null;
  size?: MantineNumberSize;
  replaceNavigation?: boolean;
};
