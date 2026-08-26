import type { Meta, StoryObj } from '@storybook/vue3-vite';
import EnginePicker from './EnginePicker.vue';

/**
 * Which engine a new connection is for.
 *
 * Nine of them, four not relational at all — the picker is the first place the
 * app admits that, and every choice here changes which fields the form then
 * asks for.
 */
const meta = {
  title: 'Connection/EnginePicker',
  component: EnginePicker,
  args: { modelValue: null },
  render: (args) => ({
    components: { EnginePicker },
    setup: () => ({ args }),
    template: `<div style="width:34rem;"><EnginePicker v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof EnginePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingChosen: Story = {};
export const Postgres: Story = { args: { modelValue: 'postgres' } };
export const Sqlite: Story = { args: { modelValue: 'sqlite' } };
export const Mongo: Story = { args: { modelValue: 'mongodb' } };
