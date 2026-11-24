import { useLayoutEffect, useRef } from 'react';
import { DialogLayer, useDialogs } from './dialogs';

export function PhotoDialog() {
  const { dialog, close } = useDialogs();
  // Retain the last preview src when the layer closes, as the original did.
  const previous = useRef<string | undefined>(undefined);
  const url = dialog?.kind === 'photo' ? dialog.url : previous.current;
  useLayoutEffect(() => {
    previous.current = url;
  }, [url]);
  return (
    <DialogLayer kind="photo" id="photo-modal" layer="photo-layer">
      <section
        data-track="student.index.section.56"
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="照片预览"
      >
        <button
          data-track="student.index.button.57"
          type="button"
          id="close-photo"
          className="secondary-btn"
          onClick={close}
        >
          关闭预览
        </button>
        <img id="photo-large" src={url} alt="故障照片预览" />
      </section>
    </DialogLayer>
  );
}
