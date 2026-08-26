import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { withEntities } from '../../../../.storybook/seed';
import TableTab from './TableTab.vue';

/**
 * A table, open.
 *
 * The pane is a toolbar, a grid and a pager; the toolbar is one definition
 * shared with every other tab, so everything in the row is the same height and
 * shape and loudness carries the difference.
 *
 * **These stories show the tab without its grid populated, and that is a
 * limitation of the storybook rather than of the component.** The grid is
 * Tabulator, which owns the DOM inside its container; Storybook mounts and
 * unmounts a story more than once while settling, and the second pass patches
 * Vue's tree around nodes Tabulator has replaced — the component then emits
 * from an instance Vue has already torn down. It does not happen in the app,
 * where a tab is mounted once and lives until it is closed; that was checked
 * against the built app, with a page-error listener attached, before this note
 * was written.
 *
 * The populated tab is in **Pages/Workspace → With a table**, which mounts this
 * component inside the pane it actually lives in and renders correctly.
 */
const meta = {
  title: 'Tabs/TableTab',
  component: TableTab,
  args: { entity: { name: 'album', schema: 'music' }, active: false },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { TableTab },
    setup: () => {
      withEntities();
      return { args };
    },
    template: `
      <div style="width:60rem; height:32rem; display:flex;">
        <TableTab
          :key="args.entity.schema + '.' + args.entity.name"
          :entity="args.entity"
          :active="args.active"
        />
      </div>
    `,
  }),
} satisfies Meta<typeof TableTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The chrome: the toolbar, the filter affordance, the pager. */
export const Chrome: Story = {};

/** A table with no schema, which is most engines. */
export const Unqualified: Story = { args: { entity: { name: 'daily_metrics' } } };
