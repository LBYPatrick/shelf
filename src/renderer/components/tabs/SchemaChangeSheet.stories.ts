import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SchemaChangeSheet from './SchemaChangeSheet.vue';

/**
 * A change to the shape of the database, shown as the statement it will run.
 *
 * Anything destructive requires the object's name to be typed. Not a
 * confirmation dialog — those are clicked through — but an act that cannot be
 * performed by accident.
 */
const meta = {
  title: 'Tabs/SchemaChangeSheet',
  component: SchemaChangeSheet,
  args: {
    modelValue: true,
    engine: 'postgres',
    running: false,
    change: {
      kind: 'add-column',
      entity: { name: 'album', schema: 'music' },
      name: 'reissued',
      dataType: 'boolean',
      nullable: true,
      defaultValue: 'false',
    },
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SchemaChangeSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AddColumn: Story = {};

/** Destructive: the name has to be typed before Apply does anything. */
export const DropColumn: Story = {
  args: {
    change: {
      kind: 'drop-column',
      entity: { name: 'album', schema: 'music' },
      name: 'runtime_seconds',
    },
  },
};

export const Running: Story = { args: { running: true } };

/** The same change on another engine, which writes it differently. */
export const OnMysql: Story = { args: { engine: 'mysql' } };
