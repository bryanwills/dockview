import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { DockviewApi, DockviewReadyEvent, IDockviewPanelProps } from 'dockview';
import { DockviewReact } from '../../dockview/dockview';

// Guards #1594: a bare DockviewReact (no dockview-enterprise) must mount without
// logging a missing-module error. The wrapper installs framework bridges such as
// `createContextMenuItemComponent` unconditionally, and none of them may be read
// as declared intent for an enterprise module. Kept in its own file so the
// once-per-process missing-module dedup cache starts empty and this mount is the
// first that could surface the message.
describe('DockviewReact bare mount', () => {
    test('does not warn about a missing dockview-enterprise module (#1594)', async () => {
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            const components = {
                default: (_props: IDockviewPanelProps) => <div />,
            };

            let api: DockviewApi | undefined;
            render(
                <DockviewReact
                    components={components}
                    onReady={(event: DockviewReadyEvent) => {
                        api = event.api;
                    }}
                />
            );

            await waitFor(() => expect(api).toBeTruthy());

            const enterpriseWarnings = errorSpy.mock.calls
                .map((call) => String(call[0]))
                .filter((message) => message.includes('dockview-enterprise'));

            expect(enterpriseWarnings).toEqual([]);
        } finally {
            errorSpy.mockRestore();
        }
    });
});
