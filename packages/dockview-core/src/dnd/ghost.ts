import { addClasses, getOverlayParent, removeClasses } from '../dom';

export function addGhostImage(
    dataTransfer: DataTransfer,
    ghostElement: HTMLElement,
    options?: {
        x?: number;
        y?: number;
        ownerDocument?: Document;
        /** The drag source. When it is inside a shadow root the ghost is
         *  appended there, so the styles scoped to that root apply. */
        owner?: Node;
    }
): void {
    // class dockview provides to force ghost image to be drawn on a different layer and prevent weird rendering issues
    addClasses(ghostElement, 'dv-dragged');

    // move the element off-screen initially otherwise it may in some cases be rendered at (0,0) momentarily
    ghostElement.style.top = '-9999px';

    // Append to the drag source's own document (inside its shadow root, when
    // it has one, so the styles scoped there apply). Per spec a setDragImage
    // element that is cross-document relative to the drag's DataTransfer is
    // ignored, so a drag initiated inside a popout window must use the popout
    // document, not the main one.
    const parent = options?.owner
        ? getOverlayParent(options.owner)
        : (options?.ownerDocument ?? document).body;
    parent.appendChild(ghostElement);
    dataTransfer.setDragImage(ghostElement, options?.x ?? 0, options?.y ?? 0);

    setTimeout(() => {
        removeClasses(ghostElement, 'dv-dragged');
        ghostElement.remove();
    }, 0);
}
