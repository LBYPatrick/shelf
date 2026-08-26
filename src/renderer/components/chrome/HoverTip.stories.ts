import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { vTip } from '@renderer/lib/hoverTip';
import AppIcon from '../ui/AppIcon.vue';
import HoverTip from './HoverTip.vue';

/**
 * The label an icon-only control carries.
 *
 * Not the OS tooltip: that arrives after a second and a half, in a corner of
 * its own choosing, styled by the platform. This one appears beside the
 * control, on focus as well as hover, and skips its delay while another is
 * already up — because moving along a row of icons is one gesture.
 *
 * Hover one of the buttons below to see it.
 */
const meta = {
  title: 'Chrome/HoverTip',
  component: HoverTip,
  parameters: { layout: 'centered' },
  render: () => ({
    components: { HoverTip, AppIcon },
    directives: { tip: vTip },
    template: `
      <div style="display:flex; gap:0.25rem; padding:3rem;">
        <button v-tip="'Refresh the schema — F5'" style="display:grid; place-items:center;
                width:var(--hit-min); height:var(--hit-min); border-radius:var(--radius-field);">
          <AppIcon name="refresh" :size="14" />
        </button>
        <button v-tip="'Export data to a file'" style="display:grid; place-items:center;
                width:var(--hit-min); height:var(--hit-min); border-radius:var(--radius-field);">
          <AppIcon name="download" :size="14" />
        </button>
        <button v-tip="'Discard this job'" style="display:grid; place-items:center;
                width:var(--hit-min); height:var(--hit-min); border-radius:var(--radius-field);">
          <AppIcon name="trash" :size="14" />
        </button>
        <HoverTip />
      </div>
    `,
  }),
} satisfies Meta<typeof HoverTip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnARowOfIcons: Story = {};
