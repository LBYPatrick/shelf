import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ToastItem from './ToastItem.vue';

/**
 * One notice.
 *
 * A failure is an alert and is read out of turn; the rest are status and wait
 * their turn — saying everything urgently is the same as saying nothing is.
 */
const meta = {
  title: 'Chrome/ToastItem',
  component: ToastItem,
  args: {
    notice: { id: '1', tone: 'success', message: 'Exported 64 rows to albums.csv' },
  },
  render: (args) => ({
    components: { ToastItem },
    setup: () => ({ args }),
    template: `<div style="width:24rem;"><ToastItem v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ToastItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};

export const Info: Story = {
  args: { notice: { id: '1', tone: 'info', message: 'Discarded “june refunds”.' } },
};

export const Warning: Story = {
  args: {
    notice: {
      id: '1',
      tone: 'warning',
      message: 'This statement would change the database. It has not been run.',
    },
  },
};

/** With a title, which is what a failure gets and a status does not. */
export const Failure: Story = {
  args: {
    notice: {
      id: '1',
      tone: 'error',
      title: 'The connection host restarted',
      message: 'Every open connection is gone; reconnect to carry on.',
    },
  },
};

/** Long enough to wrap, which is most real database errors. */
export const Long: Story = {
  args: {
    notice: {
      id: '1',
      tone: 'error',
      title: 'Query failed',
      message:
        'ERROR: column "artist_name" does not exist\nLINE 1: select artist_name from music.album\n               ^\nHINT: Perhaps you meant to reference the column "album.title".',
    },
  },
};

export const EveryTone: Story = {
  render: () => ({
    components: { ToastItem },
    setup: () => ({
      notices: [
        { id: '1', tone: 'info', message: 'Nothing to report.' },
        { id: '2', tone: 'success', message: 'Applied 3 changes.' },
        { id: '3', tone: 'warning', message: 'Cut off at the row limit.' },
        { id: '4', tone: 'error', title: 'Failed', message: 'Relation does not exist.' },
      ],
    }),
    template: `
      <div style="display:flex; flex-direction:column; gap:0.5rem; width:24rem;">
        <ToastItem v-for="n in notices" :key="n.id" :notice="n" />
      </div>
    `,
  }),
};
