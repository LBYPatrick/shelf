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

/**
 * Three at once, one tone each. Every one of them is drawn and readable: the
 * column is the point, because a message nobody can read is a message that was
 * not raised.
 */
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

/**
 * More than fits comfortably, which is how the corner behaves under load.
 *
 * Six notices wrapping onto two lines each is most of the height of a small
 * window, and it is worth being able to look at: they expire on their own
 * timers, so the column empties from wherever each one happens to be.
 */
export const Many: Story = {
  render: () =>
    stack((toasts) => {
      for (let index = 1; index <= 6; index += 1) {
        toasts.show({
          id: `many-${index}`,
          tone: (['info', 'success', 'warning', 'error'] as const)[index % 4]!,
          message: `Notice number ${index}, which is long enough to wrap onto a second line.`,
        });
      }
    }),
};

export const Empty: Story = { render: () => stack(() => undefined) };
