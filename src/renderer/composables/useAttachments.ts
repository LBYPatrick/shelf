import { ref } from 'vue';
import type { AiAttachment } from '@shared/ai';
import { MAX_IMAGE_BYTES, attachmentKind } from '@shared/aiAttachments';

/**
 * Files put with a question, while it is being written.
 *
 * The reading happens here rather than in the host, because the file is already
 * in the window: a drop, a paste and a file picker all hand the renderer a
 * `File`, and sending a *path* to the host to be read again would be a second
 * way in to the filesystem for no gain.
 *
 * What crosses the boundary afterwards is a string either way — the text, or
 * base64 — which survives a structured clone without the transcoder.
 */

export interface Rejected {
  readonly name: string;
  readonly why: 'kind' | 'size';
}

export function useAttachments(canTakeImages: () => boolean) {
  const items = ref<AiAttachment[]>([]);

  /** What was refused on the last add, for the composer to report once. */
  const rejected = ref<Rejected[]>([]);

  async function add(files: Iterable<File>): Promise<void> {
    const refused: Rejected[] = [];
    const taken: AiAttachment[] = [];

    for (const file of files) {
      const kind = attachmentKind(file.name, file.type);

      /*
       * A picture the provider cannot read is refused here rather than dropped
       * silently at the far end. The agent enforces the same rule again — this
       * is the half that can explain itself, and that one is the half that
       * holds if the provider is changed after the file was chosen.
       */
      if (kind === null || (kind === 'image' && !canTakeImages())) {
        refused.push({ name: file.name, why: 'kind' });
        continue;
      }

      if (kind === 'image' && file.size > MAX_IMAGE_BYTES) {
        refused.push({ name: file.name, why: 'size' });
        continue;
      }

      taken.push(
        kind === 'text'
          ? { kind: 'text', name: file.name, text: await file.text() }
          : {
              kind: 'image',
              name: file.name,
              mediaType: file.type,
              base64: await base64Of(file),
            }
      );
    }

    if (taken.length > 0) items.value = [...items.value, ...taken];
    rejected.value = refused;
  }

  function remove(at: number): void {
    items.value = items.value.filter((_, index) => index !== at);
  }

  function clear(): void {
    items.value = [];
    rejected.value = [];
  }

  return { items, rejected, add, remove, clear };
}

/**
 * The bytes, base64'd, without holding a second copy as a string of numbers.
 *
 * `FileReader` gives back a data URL, so the payload is everything after the
 * comma. Going through `btoa` on a binary string instead is where large images
 * blow the stack — `String.fromCharCode(...bytes)` spreads a megabyte of
 * arguments onto it.
 */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
