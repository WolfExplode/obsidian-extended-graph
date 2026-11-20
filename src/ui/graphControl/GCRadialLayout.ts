import { Setting } from "obsidian";
import type { GraphView, LocalGraphView } from "obsidian-typings";
import { t } from "../../globalVariables";
import { ExtendedGraphInstances } from "../../pluginInstances";
import { GCSection } from "./GCSection";

export class GCRadialLayout extends GCSection {
    constructor(view: GraphView | LocalGraphView) {
        super(view, "layout", t("radialLayout.heading"));
        this.treeItemChildren = this.root.createDiv("tree-item-children");
        this.collapseGraphControlSection();
    }

    override display(enabled: boolean) {
        this.root.hidden = !enabled;
        this.treeItemChildren.empty();
        const instances = this.instances;
        if (!enabled || !instances) return;
        const layout = instances.radialLayout;

        const preferences = ExtendedGraphInstances.settings.radialAutoLayout;
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.automatic"))
            .setDesc(t("radialLayout.automaticDesc"))
            .addToggle(toggle => toggle.setValue(preferences[instances.type]).onChange(value => {
                preferences[instances.type] = value;
                if (value) layout.setAutomatic();
                else layout.clear();
                void ExtendedGraphInstances.plugin.saveSettings();
            }));

        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.hierarchy"))
            .addDropdown(dropdown => dropdown
                .addOption("parents", t("radialLayout.parentLinks"))
                .addOption("outgoing", t("radialLayout.outgoingLinks"))
                .setValue(layout.hierarchy)
                .onChange(value => {
                    layout.hierarchy = value === "outgoing" ? "outgoing" : "parents";
                    layout.refresh(true);
                }));
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.spacing"))
            .addSlider(slider => slider
                .setLimits(80, 480, 20)
                .setValue(layout.spacing)
                .setDynamicTooltip()
                .onChange(value => {
                    layout.spacing = value;
                    layout.refresh(true);
                }));
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.crossLinks"))
            .addToggle(toggle => toggle
                .setValue(layout.showCrossLinks)
                .onChange(value => {
                    layout.showCrossLinks = value;
                    layout.refresh();
                }));
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.animate"))
            .addToggle(toggle => toggle.setValue(layout.animate).onChange(value => {
                ExtendedGraphInstances.settings.radialMotion = value;
                void ExtendedGraphInstances.plugin.saveSettings();
                this.view.renderer.changed();
            }));
    }
}

