import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { SAVED_CONNECTIONS } from '../../../../.storybook/fixtures/database';
import ConnectionEditor from './ConnectionEditor.vue';

/** The form, in the sheet that owns saving and testing it. */
const meta = {
  title: 'Connection/ConnectionEditor',
  component: ConnectionEditor,
  args: { editing: null, keyringAvailable: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ConnectionEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const New: Story = {};
export const Editing: Story = { args: { editing: SAVED_CONNECTIONS[0]! } };
export const WithoutKeyring: Story = {
  args: { editing: SAVED_CONNECTIONS[1]!, keyringAvailable: false },
};
