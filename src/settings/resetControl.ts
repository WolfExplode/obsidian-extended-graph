import { AbstractTextComponent, ColorComponent, DropdownComponent, SliderComponent, ToggleComponent, ValueComponent } from "obsidian";

const resets = new WeakMap<HTMLElement, () => void>();

export function onMiddleClickReset(element: HTMLElement, reset: () => void): void {
    if (!resets.has(element)) {
        const intercept = (event: MouseEvent) => {
            if (event.button !== 1) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.type === "auxclick") resets.get(element)?.();
        };
        // Suppress autoscroll and middle-click paste before the mouse button is released.
        element.addEventListener("mousedown", intercept);
        element.addEventListener("auxclick", intercept);
    }
    resets.set(element, reset);
}

export function resetValue<T>(control: ValueComponent<T>, defaultValue: T | (() => T)): void {
    const element = control instanceof ToggleComponent ? control.toggleEl
        : control instanceof SliderComponent ? control.sliderEl
        : control instanceof DropdownComponent ? control.selectEl
        : control instanceof ColorComponent ? control.colorPickerEl
        : control instanceof AbstractTextComponent ? control.inputEl : undefined;
    if (!element) return;

    onMiddleClickReset(element, () => {
        if (control.disabled) return;
        const value = typeof defaultValue === "function" ? (defaultValue as () => T)() : defaultValue;
        control.setValue(value);
        // Sliders and toggles already run their change handler from setValue.
        if (control instanceof SliderComponent || control instanceof ToggleComponent) return;
        const eventType = control instanceof AbstractTextComponent ? "input" : "change";
        element.dispatchEvent(new (element.ownerDocument.defaultView?.Event ?? Event)(eventType, { bubbles: true }));
    });
}
