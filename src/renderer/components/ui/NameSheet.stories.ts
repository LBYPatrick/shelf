import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import { withProvider } from '../../../../.storybook/seed';
import NameSheet from './NameSheet.vue';

/**
 * The sheet that asks what to call something.
 *
 * Two flows share it — saving a query and dispatching a job — so it is worth
 * looking at on its own, and one of its two states is hard to reach in the app:
 * with no provider configured the button beside the field is not there at all,
 * and the row has to hold together either way.
 */
const meta = {
  title: 'UI/NameSheet',
  component: NameSheet,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NameSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

const sheet = (name: string, seed?: () => unknown) => ({
  components: { NameSheet },
  setup: () => {
    void seed?.();
    return { open: ref(true), name: ref(name) };
  },
  template: `
    <div style="height:26rem;">
      <NameSheet
        v-model="open"
        v-model:name="name"
        title="Save query"
        label="Name"
        help="Saved against this connection, and listed under the star in the sidebar."
        confirm="Save"
        sql="select artist.name, count(*) from music.album join music.artist on artist.id = album.artist_id group by 1"
      />
    </div>
  `,
});

/**
 * With an assistant configured, which is when the button is offered. Pressing
 * it replaces what is in the box — the mock answers after a moment, so the
 * waiting state is the thing to watch.
 */
export const WithAssistant: Story = { render: () => sheet('Query 3', withProvider) };

/**
 * With none. The field is the whole row, rather than a field with a gap beside
 * it where a control used to be.
 */
export const WithoutAssistant: Story = { render: () => sheet('Query 3') };

/** Opening on the name a tab was given, which is the common case. */
export const RenamedTab: Story = { render: () => sheet('Monthly revenue', withProvider) };
