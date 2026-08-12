import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockviewAngularComponent } from '../lib/dockview/dockview-angular.component';
import { setupTestBed, getTestComponents } from './__test_utils__/test-helpers';

// Guards #1594 for the Angular wrapper: initialising the component without
// dockview-enterprise must not log a missing-module error. The wrapper installs
// framework bridges such as `createContextMenuItemComponent` unconditionally,
// and none may be read as declared intent for an enterprise module. Kept in its
// own file so the process-global missing-module dedup cache is empty for this
// first init.
describe('DockviewAngularComponent bare mount', () => {
    let component: DockviewAngularComponent;
    let fixture: ComponentFixture<DockviewAngularComponent>;

    beforeEach(async () => {
        setupTestBed();
        await TestBed.compileComponents();

        fixture = TestBed.createComponent(DockviewAngularComponent);
        component = fixture.componentInstance;
        component.components = getTestComponents();
    });

    afterEach(() => {
        component?.getDockviewApi()?.dispose();
        fixture?.destroy();
    });

    it('does not warn about a missing dockview-enterprise module (#1594)', () => {
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            component.ngOnInit();

            const enterpriseWarnings = errorSpy.mock.calls
                .map((call) => String(call[0]))
                .filter((message) => message.includes('dockview-enterprise'));

            expect(enterpriseWarnings).toEqual([]);
        } finally {
            errorSpy.mockRestore();
        }
    });
});
