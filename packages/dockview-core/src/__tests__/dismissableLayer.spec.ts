import { createDismissableLayer } from '../dismissableLayer';

describe('createDismissableLayer', () => {
    let inside: HTMLElement;
    let outside: HTMLElement;

    beforeEach(() => {
        inside = document.createElement('div');
        outside = document.createElement('div');
        document.body.appendChild(inside);
        document.body.appendChild(outside);
    });

    afterEach(() => {
        inside.remove();
        outside.remove();
    });

    const keydown = (key: string) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    const pointerdownOn = (el: HTMLElement, x = 0) =>
        el.dispatchEvent(
            new MouseEvent('pointerdown', { bubbles: true, clientX: x })
        );

    test('Escape dismisses by default; other keys do not', () => {
        const onDismiss = jest.fn();
        const layer = createDismissableLayer({ onDismiss });

        keydown('a');
        expect(onDismiss).not.toHaveBeenCalled();
        keydown('Escape');
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('extra keys dismiss when configured', () => {
        const onDismiss = jest.fn();
        const layer = createDismissableLayer({ onDismiss, keys: ['Enter'] });

        keydown('Enter');
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('outside pointerdown dismisses; inside (contains) does not', () => {
        const onDismiss = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            elements: () => [inside],
        });

        pointerdownOn(inside);
        expect(onDismiss).not.toHaveBeenCalled();
        pointerdownOn(outside);
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('onInsidePointerDown fires for inside pointerdowns', () => {
        const onDismiss = jest.fn();
        const onInsidePointerDown = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            onInsidePointerDown,
            elements: () => [inside],
        });

        pointerdownOn(inside);
        expect(onInsidePointerDown).toHaveBeenCalledTimes(1);
        expect(onDismiss).not.toHaveBeenCalled();

        layer.dispose();
    });

    test('an isInside predicate overrides the contains check (geometry)', () => {
        const onDismiss = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            isInside: (e) => e.clientX < 100,
        });

        pointerdownOn(outside, 50); // "inside" by geometry
        expect(onDismiss).not.toHaveBeenCalled();
        pointerdownOn(outside, 150); // outside
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('the grace window ignores outside-pointerdowns just after opening', () => {
        const onDismiss = jest.fn();
        let clock = 1000;
        const layer = createDismissableLayer({
            onDismiss,
            elements: () => [inside],
            pointerDownGraceMs: 200,
            now: () => clock,
        });

        clock = 1100; // within the 200ms grace
        pointerdownOn(outside);
        expect(onDismiss).not.toHaveBeenCalled();

        clock = 1300; // past the grace
        pointerdownOn(outside);
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('resize dismisses when enabled, and dispose detaches every listener', () => {
        const onDismiss = jest.fn();
        const layer = createDismissableLayer({ onDismiss, resize: true });

        window.dispatchEvent(new Event('resize'));
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
        window.dispatchEvent(new Event('resize'));
        keydown('Escape');
        expect(onDismiss).toHaveBeenCalledTimes(1); // no further calls
    });

    test('focusOut dismisses when focus lands outside the layer', () => {
        const onDismiss = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            focusOut: true,
            elements: () => [inside],
        });

        inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(onDismiss).not.toHaveBeenCalled();
        outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('focusOut uses an isFocusInside predicate when provided', () => {
        const onDismiss = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            focusOut: true,
            isFocusInside: (el) => el === inside,
        });

        inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(onDismiss).not.toHaveBeenCalled();
        outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('pointerdown and focusin inside a shadow root count as inside', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });
        const menu = document.createElement('div');
        const item = document.createElement('button');
        menu.appendChild(item);
        root.appendChild(menu);

        const onDismiss = jest.fn();
        const onInsidePointerDown = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            onInsidePointerDown,
            focusOut: true,
            elements: () => [menu],
        });

        item.dispatchEvent(
            new MouseEvent('pointerdown', { bubbles: true, composed: true })
        );
        item.dispatchEvent(
            new FocusEvent('focusin', { bubbles: true, composed: true })
        );
        expect(onInsidePointerDown).toHaveBeenCalledTimes(1);
        expect(onDismiss).not.toHaveBeenCalled();

        pointerdownOn(outside);
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
        host.remove();
    });

    // Regression guard: this layout already worked through retargeting; the
    // composed-path check must keep it working.
    test('pointerdown and focusin inside a web component within the layer count as inside', () => {
        const host = document.createElement('div');
        inside.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });
        const item = document.createElement('button');
        root.appendChild(item);

        const onDismiss = jest.fn();
        const onInsidePointerDown = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            onInsidePointerDown,
            focusOut: true,
            elements: () => [inside],
        });

        item.dispatchEvent(
            new MouseEvent('pointerdown', { bubbles: true, composed: true })
        );
        item.dispatchEvent(
            new FocusEvent('focusin', { bubbles: true, composed: true })
        );
        expect(onInsidePointerDown).toHaveBeenCalledTimes(1);
        expect(onDismiss).not.toHaveBeenCalled();

        pointerdownOn(outside);
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
    });

    test('focusOut sees focus moving within the shadow root the layer lives in', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadowRoot = host.attachShadow({ mode: 'open' });
        const menu = document.createElement('div');
        const item = document.createElement('button');
        menu.appendChild(item);
        const elsewhere = document.createElement('button');
        shadowRoot.append(menu, elsewhere);

        const onDismiss = jest.fn();
        const layer = createDismissableLayer({
            onDismiss,
            focusOut: true,
            elements: () => [menu],
        });

        // Entering the shadow root reaches both the root and the window
        // listeners; it must count once, as inside.
        item.focus();
        expect(onDismiss).not.toHaveBeenCalled();

        // A move within the root never reaches the window.
        elsewhere.focus();
        expect(onDismiss).toHaveBeenCalledTimes(1);

        layer.dispose();
        host.remove();
    });

    test('a custom isFocusInside gets the focus target as the window sees it', () => {
        const panel = document.createElement('div');
        document.body.appendChild(panel);
        const componentHost = document.createElement('div');
        panel.appendChild(componentHost);
        const input = document.createElement('input');
        componentHost.attachShadow({ mode: 'open' }).appendChild(input);

        const onDismiss = jest.fn();
        const isFocusInside = jest.fn((el: Element) => panel.contains(el));
        const layer = createDismissableLayer({
            onDismiss,
            focusOut: true,
            isFocusInside,
        });

        input.focus();
        expect(isFocusInside).toHaveBeenCalledWith(componentHost);
        expect(onDismiss).not.toHaveBeenCalled();

        layer.dispose();
        panel.remove();
    });
});
