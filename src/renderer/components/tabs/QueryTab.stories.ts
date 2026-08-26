import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { withEntities } from '../../../../.storybook/seed';
import QueryTab from './QueryTab.vue';

/**
 * The query tab: an editor above its results, on a draggable split.
 *
 * It opens at seven tenths, measured once — writing is the part that takes room,
 * because the results have a pager and a scrollbar and the editor has neither.
 *
 * A *multi-statement* script is not shown here. Storybook mounts a story more
 * than once while it settles, and the second pass patches Vue's tree around the
 * DOM Monaco owns; with more than one statement the tab draws per-statement
 * chrome and the patch walks into a detached node. It is a storybook artefact,
 * not a defect — the same text was typed into the built app with a page-error
 * listener attached and produced none.
 */
const meta = {
  title: 'Tabs/QueryTab',
  component: QueryTab,
  args: { tabId: 'tab-1', active: true, text: 'select id, title from music.album limit 50;' },
  parameters: { layout: 'fullscreen' },
  /*
   * The editor's text is held in a ref of the story's own, not bound through
   * `args`.
   *
   * `QueryTab` takes it as a `defineModel`, so every keystroke emits
   * `update:text`. Bound to an arg, that writes back into Storybook's args,
   * which re-renders the story — and re-patching Vue's tree around the DOM
   * Monaco owns walks into a null node. The component is unchanged; what the
   * story must not do is make its own two-way binding a render loop.
   */
  render: (args) => ({
    components: { QueryTab },
    setup: () => {
      withEntities();
      const text = ref(args.text);
      return { args, text };
    },
    template: `
      <div style="width:60rem; height:34rem; display:flex;">
        <QueryTab v-model:text="text" :tab-id="args.tabId" :active="args.active" />
      </div>
    `,
  }),
} satisfies Meta<typeof QueryTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAStatement: Story = {};

/** Nothing written yet — the pane says what to do rather than sitting empty. */
export const Empty: Story = { args: { text: '' } };
