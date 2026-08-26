import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useEntities } from '@renderer/stores/entities';
import { connected, withEntities } from '../../../../.storybook/seed';
import EntityTree from './EntityTree.vue';

/**
 * The entity list.
 *
 * Virtualised over a flattened tree, so a schema with tens of thousands of
 * tables scrolls as smoothly as one with ten. Scroll anchoring is off: the
 * browser holding a position steady by adjusting `scrollTop` is the exact
 * opposite of what a recycler wants.
 */
const frame = `<div style="width:17rem; height:26rem; display:flex;"><EntityTree /></div>`;

const meta = {
  title: 'Sidebar/EntityTree',
  component: EntityTree,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { EntityTree },
    setup: () => {
      withEntities({ expand: ['music'] });
      return {};
    },
    template: frame,
  }),
} satisfies Meta<typeof EntityTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {};

export const Collapsed: Story = {
  render: () => ({
    components: { EntityTree },
    setup: () => {
      withEntities();
      return {};
    },
    template: frame,
  }),
};

export const Loading: Story = {
  render: () => ({
    components: { EntityTree },
    setup: () => {
      connected();
      useEntities().loading = true;
      return {};
    },
    template: frame,
  }),
};

/** A schema that could not be read, which says so instead of showing nothing. */
export const Failed: Story = {
  render: () => ({
    components: { EntityTree },
    setup: () => {
      connected();
      const entities = useEntities();
      entities.loading = false;
      entities.error = 'permission denied for schema music';
      return {};
    },
    template: frame,
  }),
};

export const NoTables: Story = {
  render: () => ({
    components: { EntityTree },
    setup: () => {
      connected();
      const entities = useEntities();
      entities.entities = [];
      entities.loading = false;
      return {};
    },
    template: frame,
  }),
};

/** Enough of them that the virtualiser is doing the work. */
export const Thousands: Story = {
  render: () => ({
    components: { EntityTree },
    setup: () => {
      connected();
      const entities = useEntities();
      entities.schemas = ['bulk'];
      entities.entities = Array.from({ length: 5_000 }, (_unused, index) => ({
        name: `table_${String(index).padStart(5, '0')}`,
        schema: 'bulk',
        kind: 'table' as const,
      }));
      entities.loading = false;
      entities.expanded.add('bulk');
      return {};
    },
    template: frame,
  }),
};
