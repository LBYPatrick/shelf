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
 * Three at once, which is the pile: the newest fully drawn at the front and the
 * two behind it peeking out. Hovering it opens the column.
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
 * More than the pile draws.
 *
 * Past the third card the rest are held but not shown — they are still counting
 * down and still there when the pile opens, and drawing eight overlapping cards
 * in a corner says nothing the third one has not already said.
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
