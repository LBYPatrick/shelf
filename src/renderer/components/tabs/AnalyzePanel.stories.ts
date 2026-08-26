import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import AnalyzePanel from './AnalyzePanel.vue';

/**
 * What the server says about itself.
 *
 * Every counter an engine keeps is cumulative since it last reset them, so "the
 * last hour" does not exist to be asked for — the app stores its own readings
 * and differences them, and says so when a window is wider than the history
 * behind it.
 */
const meta = {
  title: 'Tabs/AnalyzePanel',
  component: AnalyzePanel,
  args: { section: 'queries', active: true },
  argTypes: { section: { control: 'inline-radio', options: ['queries', 'server'] } },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { AnalyzePanel },
    setup: () => {
      connected();
      return { args };
    },
    template: `<div style="width:58rem; height:30rem; display:flex;"><AnalyzePanel v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof AnalyzePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Queries: Story = {};
export const Server: Story = { args: { section: 'server' } };
