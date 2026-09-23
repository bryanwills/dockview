import {
    DockviewComponentOptions,
    DockviewIDisposable as IDisposable,
    KeyboardNavigationOptions,
} from 'dockview';

/**
 * Marks (on the dockview root element) that a keyboard move is in progress, so
 * the default navigation listener stands down while the advanced docking module
 * drives the keys. A neutral DOM signal keeps the two listeners coordinated
 * without either service holding a reference to the other.
 */
export const KEYBOARD_MOVE_ATTRIBUTE = 'data-dv-kbd-moving';

/**
 * Does `e` match a binding string like `'ctrl+]'` / `'shift+f6'`? Modifiers are
 * matched exactly (a binding without `shift` will not fire while Shift is held),
 * and the final part is compared to `KeyboardEvent.key`, lower-cased.
 */
export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
    const parts = binding.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    return (
        e.ctrlKey === mods.includes('ctrl') &&
        e.shiftKey === mods.includes('shift') &&
        e.altKey === mods.includes('alt') &&
        e.metaKey === (mods.includes('meta') || mods.includes('cmd')) &&
        e.key.toLowerCase() === key
    );
}

/**
 * Resolve the `keyboardNavigation` opt-in to its options object, or `undefined`
 * when keyboard support is off. Both keyboard modules read the same opt-in.
 */
export function readKeyboardNavigation(
    options: DockviewComponentOptions
): KeyboardNavigationOptions | undefined {
    const opt = options.keyboardNavigation;
    if (!opt) {
        return undefined;
    }
    return opt === true ? {} : opt;
}

/**
 * The node an event came from, as seen from `anchor`'s tree. A listener on the
 * document sees events from a dock mounted in a shadow root retargeted to the
 * shadow host, so walk the composed path to the innermost node that lives in
 * `anchor`'s root (or directly in a document, e.g. a popout). Shadow roots
 * nested inside panel content are still retargeted to their host, as before.
 *
 * Must be called during dispatch: `composedPath()` is empty once the event has
 * finished, and the fallback is then the (retargeted) `e.target`.
 */
export function eventOrigin(e: Event, anchor: Node): EventTarget | null {
    const root = anchor.getRootNode();
    for (const node of e.composedPath?.() ?? []) {
        if (typeof (node as Node).getRootNode !== 'function') {
            continue;
        }
        const nodeRoot = (node as Node).getRootNode();
        if (nodeRoot === root || nodeRoot.nodeType === Node.DOCUMENT_NODE) {
            return node;
        }
    }
    return e.target;
}

/**
 * The focused element as seen from `anchor`'s tree. `document.activeElement` is
 * the shadow host when focus is inside a shadow root, so read the anchor's root
 * node (its shadow root, else its document) instead.
 */
export function activeElementOf(anchor: Node): Element | null {
    const root = anchor.getRootNode() as Node & Partial<DocumentOrShadowRoot>;
    if (root.activeElement !== undefined) {
        return root.activeElement;
    }
    // Detached: the root is the node's own subtree, which has no focus state.
    return anchor.ownerDocument?.activeElement ?? null;
}

/** A document-level listener to mirror across every window the dock occupies. */
export interface DocumentListenerSpec {
    readonly type: string;
    readonly handler: (e: Event) => void;
    /** Capture phase? Must match the value used to remove the listener. */
    readonly capture: boolean;
}

/** The slice of the accessibility host the multi-window binder needs. */
interface MultiWindowHost {
    readonly rootElement: HTMLElement;
    getPopoutWindows(): Window[];
    onDidChangePopouts(listener: () => void): IDisposable;
}

/**
 * Attach `specs` to the main document **and to every popout document**, keeping
 * the set in sync as popouts open and close. A popout window is a separate
 * `document`, so a capture-phase listener on the main document alone never sees
 * keystrokes made inside a popout, so each document needs its own listener.
 *
 * A popout that shares the main document (the jsdom mock) is skipped, since the
 * main document's listener already covers it and a second would double-fire.
 *
 * Returns a disposable that removes every listener from every document.
 */
export function bindDocumentListeners(
    host: MultiWindowHost,
    specs: DocumentListenerSpec[]
): IDisposable {
    const mainDoc = host.rootElement.ownerDocument;
    const attached = new Set<Document>();

    const attach = (doc: Document): void => {
        if (attached.has(doc)) {
            return;
        }
        for (const s of specs) {
            doc.addEventListener(s.type, s.handler, s.capture);
        }
        attached.add(doc);
    };
    const detach = (doc: Document): void => {
        if (!attached.has(doc)) {
            return;
        }
        for (const s of specs) {
            doc.removeEventListener(s.type, s.handler, s.capture);
        }
        attached.delete(doc);
    };

    const sync = (): void => {
        const desired = new Set<Document>([mainDoc]);
        for (const win of host.getPopoutWindows()) {
            const doc = win.document;
            if (doc === mainDoc) {
                continue;
            }
            desired.add(doc);
            attach(doc);
        }
        for (const doc of attached) {
            if (!desired.has(doc)) {
                detach(doc);
            }
        }
    };

    attach(mainDoc);
    sync();
    const sub = host.onDidChangePopouts(sync);

    return {
        dispose: () => {
            sub.dispose();
            for (const doc of attached) {
                detach(doc);
            }
        },
    };
}

/**
 * Attach `specs` to the shadow root hosting `anchor()`, if any. Document-level
 * listeners miss focus moves *within* a shadow root: `focusin`'s target and
 * relatedTarget both retarget to the host, so the event path is cut at the
 * host and never reaches the document. Only focus entering the root from
 * outside is seen there.
 *
 * Call `sync()` to re-check the anchor's root (the dock can be moved into a
 * shadow root after construction); it rebinds when the root changes. An event
 * entering the root from outside reaches both this listener and the document
 * one, so handlers must be idempotent.
 */
export function bindShadowRootListeners(
    anchor: () => Node,
    specs: DocumentListenerSpec[]
): IDisposable & { sync(): void } {
    let bound: ShadowRoot | undefined;

    const detach = (): void => {
        if (!bound) {
            return;
        }
        for (const s of specs) {
            bound.removeEventListener(s.type, s.handler, s.capture);
        }
        bound = undefined;
    };

    const sync = (): void => {
        const root = anchor().getRootNode();
        // A shadow root is the only fragment with a `host`.
        const shadow =
            root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root
                ? (root as ShadowRoot)
                : undefined;
        if (shadow === bound) {
            return;
        }
        detach();
        if (shadow) {
            for (const s of specs) {
                shadow.addEventListener(s.type, s.handler, s.capture);
            }
            bound = shadow;
        }
    };

    sync();
    return { sync, dispose: detach };
}
