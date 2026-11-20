import { Component } from "obsidian";
import { GraphView, LocalGraphView } from "obsidian-typings";
import { GCOptions, GraphInstances } from "../../internal";
import { GCRadialLayout } from "./GCRadialLayout";

export class GraphControlsUI extends Component {
    instances: GraphInstances | null;
    view: GraphView | LocalGraphView;

    graphControls: HTMLElement;

    // Sections
    sectionSettings: GCOptions;
    sectionLayout: GCRadialLayout;

    constructor(view: GraphView | LocalGraphView) {
        super();
        this.view = view;
        this.graphControls = view.contentEl.querySelector(".graph-controls") as HTMLElement;
        this.sectionLayout = this.addChild(new GCRadialLayout(view));
        this.sectionSettings = new GCOptions(view);
        this.addChild(this.sectionSettings);
    }

    onPluginEnabled(instances: GraphInstances): void {
        this.instances = instances;
        this.sectionLayout.onPluginEnabled(instances);
        this.sectionSettings.onPluginEnabled(instances);
    }

    onPluginDisabled(): void {
        this.sectionLayout.onPluginDisabled();
        this.sectionSettings.onPluginDisabled();
    }
}
