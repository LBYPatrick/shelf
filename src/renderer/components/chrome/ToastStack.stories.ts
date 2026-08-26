import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useToasts } from '@renderer/stores/toasts';
import ToastStack from './ToastStack.vue';

/**
 * Where notices land.
 *
 * Outside the view swap, because what a toast has to say usually outlives the
 * screen that caused it — losing the connection host closes the workspace, and
 * the message explaining why must not close with it.
 */
const meta = {
  title: 'Chrome/ToastStack',
  component: ToastStack,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ToastStack>;

export default meta;
type Story = StoryObj<typeof meta>;

const stack = (build: (toasts: ReturnType<typeof useToasts>) => void) => ({
  components: { ToastStack },
  setup: () => {
    build(useToasts());
    return {};
  },
  template: `<div style="height:20rem;"><ToastStack /></div>`,
});

export const One: Story = {
  render: () => stack((t) => t.show({ tone: 'success', message: 'Applied 3 changes.' })),
};

/** Several at once, oldest at the bottom. */
export const Several: Story = {
  render: () =>
    stack((toasts) => {
      toasts.show({ tone: 'info', message: 'Discarded “june refunds”.' });
      toasts.show({ tone: 'warning', message: 'Cut off at the row limit.' });
      toasts.show({
        tone: 'error',
        title: 'Query failed',
        message: 'relation "music.artistt" does not exist',
      });
    }),
};

export const Empty: Story = { render: () => stack(() => undefined) };
