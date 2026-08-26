import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import ContainerPropertiesSheet from './ContainerPropertiesSheet.vue';

/**
 * What a database or a schema *is*.
 *
 * The facts are free-form rather than a fixed record, because the interesting
 * ones differ by engine and pretending otherwise produces a form with half its
 * fields empty: Postgres has an owner, a collation and a tablespace, SQLite has
 * a page size and a journal mode, and neither has the other's.
 */
const meta = {
  title: 'Tabs/ContainerPropertiesSheet',
  component: ContainerPropertiesSheet,
  args: { modelValue: true, target: { kind: 'database', name: 'records' }, start: 'overview' },
  argTypes: { start: { control: 'inline-radio', options: ['overview', 'queries'] } },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { ContainerPropertiesSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<ContainerPropertiesSheet v-bind="args" />`,
  }),
} satisfies Meta<typeof ContainerPropertiesSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Database: Story = {};

export const Schema: Story = { args: { target: { kind: 'schema', name: 'music' } } };

/** Opened straight onto the analysis, which is what the menu's Analyze does. */
export const OnQueries: Story = { args: { start: 'queries' } };
