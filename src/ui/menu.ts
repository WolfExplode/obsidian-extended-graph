import { Component, ExtraButtonComponent, setIcon } from "obsidian";
import { GraphView, LocalGraphView } from "obsidian-typings";
import { ExtendedGraphInstances, getEngine, t } from "../internal";
import { GraphSearch } from "./graphSearch";

export class MenuUI extends Component {
    view: GraphView | LocalGraphView;

    graphControlsEl: HTMLDivElement;
    buttonEnable: ExtraButtonComponent;
    buttonReset: ExtraButtonComponent;
    private search: GraphSearch;
    enabled: boolean;

    constructor(view: GraphView | LocalGraphView) {
        super();
        this.view = view;
        const nativeFilter = getEngine(view)?.filterOptions.search;
        if (!nativeFilter) throw new Error("Graph filter is unavailable");
        this.graphControlsEl = this.view.contentEl.querySelector(".graph-controls") as HTMLDivElement;
        this.graphControlsEl.addClass("graph-controls-extended-graph");

        const hr = this.graphControlsEl.createEl("hr");
        hr.addClass("separator-exended-graph");
        this.createEnableButton();
        this.createResetButton();
        this.search = this.addChild(new GraphSearch(view, nativeFilter));
        this.register(() => {
            this.buttonEnable.extraSettingsEl.remove();
            this.buttonReset.extraSettingsEl.remove();
            hr.remove();
            this.graphControlsEl.removeClass("graph-controls-extended-graph");
        });
    }

    focusSearch() {
        this.search.focus("find");
    }

    createEnableButton() {
        this.buttonEnable = new ExtraButtonComponent(this.graphControlsEl)
            .setTooltip(`${t("controls.enable")} ${t("plugin.name")}`, { placement: 'top' })
            //.setIcon("sparkles")
            .onClick(() => {
                if (!this.enabled) {
                    ExtendedGraphInstances.graphsManager.lifecycleManager.enablePlugin(this.view);
                } else {
                    ExtendedGraphInstances.graphsManager.lifecycleManager.disablePlugin(this.view);
                }
            })
            .then(cb => {
                setIcon(cb.extraSettingsEl, "git-fork-sparkles");
                cb.extraSettingsEl.addClasses(["graph-controls-button", "mod-extended-graph-toggle"]);
            });
    }

    createResetButton() {
        this.buttonReset = new ExtraButtonComponent(this.graphControlsEl)
            .setTooltip(t("controls.resetGraph"))
            .setIcon("rotate-ccw")
            .onClick(() => {
                if (this.enabled) {
                    ExtendedGraphInstances.graphsManager.lifecycleManager.resetPlugin(this.view);
                }
            })
            .then(cb => {
                cb.extraSettingsEl.addClasses(["graph-controls-button", "mod-extended-graph-reset"]);
                cb.extraSettingsEl.remove();
            });
    }

    setEnableUIState() {
        this.enabled = true;
        this.buttonEnable.extraSettingsEl.addClass("is-active");
        this.buttonEnable.setTooltip(`${t("controls.disable")} ${t("plugin.name")}`, { placement: 'top' });
        this.graphControlsEl.insertAfter(this.buttonReset.extraSettingsEl, this.buttonEnable.extraSettingsEl);
        this.search.setActive(true);
    }

    setDisableUIState() {
        this.enabled = false;
        this.buttonEnable.extraSettingsEl.removeClass("is-active");
        this.buttonEnable.setTooltip(`${t("controls.enable")} ${t("plugin.name")}`, { placement: 'top' });
        this.buttonReset.extraSettingsEl.remove();
        this.search.setActive(false);
    }

    enableUI() {
        this.buttonEnable.setDisabled(false);
        this.buttonReset.setDisabled(false);
        this.search.setDisabled(false);
    }

    disableUI() {
        this.buttonEnable.setDisabled(true);
        this.buttonReset.setDisabled(true);
        this.search.setDisabled(true);
    }
}
