import { Setting } from "obsidian";
import type { GraphView, LocalGraphView } from "obsidian-typings";
import { t } from "../../globalVariables";
import { ExtendedGraphInstances } from "../../pluginInstances";
import type { RadialLinkSettings } from "../../settings/settings";
import { DEFAULT_SETTINGS } from "../../settings/settings";
import { onMiddleClickReset, resetValue } from "../../settings/resetControl";
import { DEFAULT_RADIAL_SPACING } from "../../graph/layout/radialLayout";
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
        const links = ExtendedGraphInstances.settings.radialLinks[instances.type];
        const linkDefaults = DEFAULT_SETTINGS.radialLinks[instances.type];

        const preferences = ExtendedGraphInstances.settings.radialAutoLayout;
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.automatic"))
            .setDesc(t("radialLayout.automaticDesc"))
            .addToggle(toggle => toggle.setValue(preferences[instances.type])
                .then(control => resetValue(control, DEFAULT_SETTINGS.radialAutoLayout[instances.type])).onChange(value => {
                preferences[instances.type] = value;
                if (value) layout.setAutomatic();
                else layout.clear();
                void ExtendedGraphInstances.plugin.saveSettings();
            }));

        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.hierarchy"))
            .setDesc(t("radialLayout.hierarchyDesc"))
            .addDropdown(dropdown => dropdown
                .addOption("parents", t("radialLayout.parentLinks"))
                .addOption("outgoing", t("radialLayout.outgoingLinks"))
                .setValue(links.hierarchy)
                .then(control => resetValue(control, linkDefaults.hierarchy))
                .onChange(value => {
                    const hierarchy = value === "outgoing" ? "outgoing" : "parents";
                    parentSelection.setDisabled(hierarchy !== "parents");
                    this.updateLinks({ hierarchy }, true);
                }));
        const parentSelection = new Setting(this.treeItemChildren)
            .setName(t("radialLayout.parentSelection"))
            .setDesc(t("radialLayout.parentSelectionDesc"))
            .addDropdown(dropdown => dropdown
                .addOption("tier", t("radialLayout.closestTier"))
                .addOption("first", t("radialLayout.firstParent"))
                .addOption("all", t("radialLayout.allParents"))
                .setValue(links.parentSelection)
                .then(control => resetValue(control, linkDefaults.parentSelection))
                .onChange(value => {
                    const parentSelection = value === "first" || value === "all" ? value : "tier";
                    this.updateLinks({ parentSelection });
                }))
            .setDisabled(links.hierarchy !== "parents");
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.crossLinks"))
            .setDesc(t("radialLayout.crossLinksDesc"))
            .addToggle(toggle => toggle
                .setValue(links.showCrossLinks)
                .then(control => resetValue(control, linkDefaults.showCrossLinks))
                .onChange(showCrossLinks => this.updateLinks({ showCrossLinks })));
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.spacing"))
            .addSlider(slider => slider
                .setLimits(80, 480, 20)
                .setValue(layout.spacing)
                .then(control => resetValue(control, DEFAULT_RADIAL_SPACING))
                .setDynamicTooltip()
                .onChange(value => {
                    layout.spacing = value;
                    layout.refresh(true);
                }));
        new Setting(this.treeItemChildren)
            .setName(t("radialLayout.animate"))
            .addToggle(toggle => {
                toggle.setValue(layout.animate).onChange(value => {
                    ExtendedGraphInstances.settings.radialMotion = value;
                    void ExtendedGraphInstances.plugin.saveSettings();
                    this.view.renderer.changed();
                });
                onMiddleClickReset(toggle.toggleEl, () => {
                    // Rebuild the toggle without calling its handler so the system preference remains the default.
                    ExtendedGraphInstances.settings.radialMotion = DEFAULT_SETTINGS.radialMotion;
                    void ExtendedGraphInstances.plugin.saveSettings();
                    this.display(true);
                    this.view.renderer.changed();
                });
            });
    }

    private updateLinks(changes: Partial<RadialLinkSettings>, fit = false): void {
        const instances = this.instances;
        if (!instances) return;
        const { settings, plugin, graphsManager } = ExtendedGraphInstances;
        const { type } = instances;
        settings.radialLinks = { ...settings.radialLinks, [type]: { ...settings.radialLinks[type], ...changes } };
        void plugin.saveSettings();
        for (const [id, graph] of graphsManager.allInstances) {
            if (graph.type !== type) continue;
            graph.radialLayout.refresh(fit);
            if (graph !== instances) graphsManager.graphLeavesManager.globalUIs.get(id)?.control.sectionLayout.display(true);
        }
    }
}

