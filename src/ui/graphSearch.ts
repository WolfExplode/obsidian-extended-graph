import { Component, getAllTags, SearchComponent, setIcon, TFile } from "obsidian";
import { GraphView, LocalGraphView } from "obsidian-typings";
import { ExtendedGraphInstances, t } from "../internal";
import { buildGraphFilter, GraphFacet, graphFacets, readGraphFilter } from "./graphFilterQuery";

type SearchMode = "filter" | "find";

export class GraphSearch extends Component {
    private root: HTMLDivElement;
    private input: HTMLInputElement;
    private chips: HTMLDivElement;
    private panel: HTMLDivElement;
    private clear: HTMLButtonElement;
    private modeButtons: Record<SearchMode, HTMLButtonElement>;
    private facetButtons: Record<GraphFacet, HTMLButtonElement>;
    private facets: HTMLDivElement;
    private active = false;
    private mode: SearchMode = "filter";
    private picker: GraphFacet | null = null;
    private pickerInput?: HTMLInputElement;
    private choices: [string, number][] = [];
    private findQuery = "";
    private filter = readGraphFilter("");
    private nativeQuery?: string;
    private nativeInput: HTMLInputElement;
    private nativeRow: HTMLElement | null;

    constructor(private view: GraphView | LocalGraphView, nativeSearch: SearchComponent) {
        super();
        const nativeInput = this.nativeInput = nativeSearch.inputEl;
        this.nativeRow = nativeInput.closest(".setting-item");
        this.root = view.contentEl.createDiv("extended-graph-search");
        const surface = this.root.createDiv("extended-graph-search-surface");
        const toolbar = surface.createDiv("extended-graph-search-toolbar");
        const modes = toolbar.createDiv({
            cls: "extended-graph-search-modes",
            attr: { role: "group", "aria-label": t("controls.graphSearchMode") }
        });
        this.modeButtons = {
            filter: this.button(modes, t("plugin.filter"), () => this.focus("filter")),
            find: this.button(modes, t("controls.findGraphNote"), () => this.focus("find"))
        };
        this.modeButtons.filter.title = t("controls.filterGraph");
        this.modeButtons.find.title = t("graphSearch.findShortcut");

        const field = toolbar.createDiv("extended-graph-search-field");
        setIcon(field.createSpan({ attr: { "aria-hidden": "true" } }), "search");
        this.input = field.createEl("input", { type: "text", attr: { spellcheck: "false", autocomplete: "off" } });
        this.clear = this.button(field, t("graphSearch.clearQuery"), () => this.clearQuery(), "x");
        this.clear.addClass("extended-graph-search-icon-button");

        this.facets = toolbar.createDiv("extended-graph-search-facets");
        this.facetButtons = {
            tags: this.button(this.facets, t("graphSearch.tags"), () => this.togglePicker("tags"), "tags"),
            folders: this.button(this.facets, t("plugin.folders"), () => this.togglePicker("folders"), "folder")
        };
        this.chips = surface.createDiv({
            cls: "extended-graph-search-chips",
            attr: { role: "group", "aria-label": t("graphSearch.activeFilters") }
        });
        this.panel = this.root.createDiv("extended-graph-search-panel");
        this.panel.id = `extended-graph-search-panel-${view.leaf.id}`;
        for (const facet of graphFacets) this.facetButtons[facet].setAttribute("aria-controls", this.panel.id);
        this.root.hidden = true;
        this.setMode("filter");
        this.refresh();
        this.fitBesideGraphControls(surface);

        this.input.addEventListener("input", event => {
            if (event instanceof InputEvent && event.isComposing) return;
            this.updateInput();
        });
        this.input.addEventListener("compositionend", () => this.updateInput());
        this.input.addEventListener("focus", () => {
            this.closePanel();
            this.refresh();
            if (this.mode === "find") this.renderFind();
        });
        this.registerDomEvent(nativeInput, "input", () => this.refresh());
        // Core graph resets and saved states write the input programmatically.
        const proxies = ExtendedGraphInstances.proxysManager;
        const setValueProxy = proxies.registerProxy<typeof nativeSearch.setValue>(nativeSearch, "setValue", {
            apply: (target, receiver, args) => {
                const result = Reflect.apply(target, receiver, args);
                this.refresh();
                return result;
            }
        });
        this.register(() => {
            if (proxies.getTargetForProxy(setValueProxy)) proxies.unregisterProxy(setValueProxy);
        });
        this.registerDomEvent(this.root, "keydown", event => this.handlePanelKey(event));
        this.registerDomEvent(this.root, "focusout", event => {
            if (event.relatedTarget && !this.root.contains(event.relatedTarget as Node)) this.closePanel();
        });
        const doc = this.root.ownerDocument;
        this.registerDomEvent(doc, "pointerdown", event => {
            if (!this.root.contains(event.target as Node)) this.closePanel();
        });
        const win = doc.defaultView;
        const onKeyDown = (event: KeyboardEvent) => {
            if (!this.active || this.input.disabled || ExtendedGraphInstances.app.workspace.activeLeaf !== view.leaf
                || doc.querySelector(".modal-container")) return;
            if ((event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey)
                || (event.key === "F3" && !event.ctrlKey && !event.metaKey && !event.altKey)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.focus("find");
            }
        };
        win?.addEventListener("keydown", onKeyDown, true);
        this.register(() => {
            win?.removeEventListener("keydown", onKeyDown, true);
            this.nativeRow?.removeClass("extended-graph-native-search-hidden");
            this.root.remove();
        });
    }

    setActive(active: boolean) {
        this.active = active;
        this.root.hidden = !active;
        this.nativeRow?.toggleClass("extended-graph-native-search-hidden", active);
        if (active) this.refresh();
        else this.closePanel();
    }

    setDisabled(disabled: boolean) {
        this.root.inert = disabled;
        this.input.disabled = disabled;
        if (disabled) this.closePanel();
    }

    focus(mode: SearchMode) {
        if (!this.active || this.input.disabled) return;
        this.closePanel();
        this.refresh();
        this.setMode(mode);
        this.input.focus();
        this.input.select();
        if (mode === "find" && this.panel.hidden) this.renderFind();
    }

    private refresh() {
        if (this.nativeQuery === this.nativeInput.value) return;
        this.nativeQuery = this.nativeInput.value;
        this.filter = readGraphFilter(this.nativeQuery);
        if (this.mode === "filter") this.input.value = this.filter.text;
        this.renderChips();
        if (this.picker) this.renderChoices();
    }

    private fitBesideGraphControls(surface: HTMLDivElement) {
        const content = this.view.contentEl;
        const controls = content.querySelector<HTMLElement>(".graph-controls");
        if (!controls) return;
        const observer = new ResizeObserver(() => {
            const controlsSpace = controls.offsetWidth + 26;
            const stack = this.active && !controls.hasClass("is-close") && content.clientWidth - controlsSpace < 320;
            this.root.style.setProperty("--graph-search-controls-space", `${stack ? 24 : Math.max(72, controlsSpace)}px`);
            controls.toggleClass("extended-graph-controls-below-search", stack);
            if (stack) controls.style.setProperty("--graph-search-controls-top", `${surface.offsetHeight + 20}px`);
            else controls.style.removeProperty("--graph-search-controls-top");
        });
        observer.observe(content);
        observer.observe(controls);
        observer.observe(surface);
        this.register(() => {
            observer.disconnect();
            controls.removeClass("extended-graph-controls-below-search");
            controls.style.removeProperty("--graph-search-controls-top");
        });
    }

    private button(parent: HTMLElement, label: string, action: () => void, icon?: string): HTMLButtonElement {
        const button = parent.createEl("button", { attr: { type: "button" } });
        if (icon) setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), icon);
        if (icon === "x") {
            button.setAttribute("aria-label", label);
            button.title = label;
        } else {
            button.createSpan({ text: label });
        }
        button.addEventListener("click", action);
        return button;
    }

    private setMode(mode: SearchMode) {
        this.mode = mode;
        for (const name of ["find", "filter"] as const) {
            this.modeButtons[name].setAttribute("aria-pressed", String(name === mode));
        }
        this.input.value = mode === "filter" ? this.filter.text : this.findQuery;
        this.input.placeholder = t(mode === "filter" ? "graphSearch.filterPlaceholder" : "graphSearch.findPlaceholder");
        this.input.setAttribute("aria-label", t(mode === "filter" ? "controls.filterGraph" : "controls.findNoteInGraph"));
        this.input.title = mode === "filter" ? t("graphSearch.queryHint") : "";
        this.facets.hidden = mode !== "filter";
        this.renderChips();
    }

    private updateInput() {
        this.clear.hidden = !this.input.value;
        if (this.mode === "find") {
            this.findQuery = this.input.value;
            this.renderFind();
        } else {
            this.filter.text = this.input.value;
            this.applyFilter();
        }
    }

    private clearQuery() {
        this.input.focus();
        this.input.value = "";
        this.updateInput();
    }

    private applyFilter() {
        this.nativeQuery = buildGraphFilter(this.filter);
        if (this.nativeInput.value !== this.nativeQuery) {
            this.nativeInput.value = this.nativeQuery;
            this.nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    private renderChips() {
        this.chips.empty();
        this.clear.hidden = !this.input.value;
        const activeCount = Number(Boolean(this.filter.text.trim())) + this.filter.tags.length + this.filter.folders.length;
        const filterLabel = t("plugin.filter");
        this.modeButtons.filter.lastElementChild!.textContent =
            this.mode === "find" && activeCount ? `${filterLabel} · ${activeCount}` : filterLabel;
        for (const facet of graphFacets) {
            const count = this.filter[facet].length;
            const label = this.facetLabel(facet);
            this.facetButtons[facet].lastElementChild!.textContent = count ? `${label} · ${count}` : label;
            this.facetButtons[facet].setAttribute("aria-expanded", String(this.picker === facet));
            if (this.mode !== "filter") continue;
            for (const value of this.filter[facet]) {
                const chip = this.chips.createDiv("extended-graph-search-chip");
                setIcon(chip.createSpan({ attr: { "aria-hidden": "true" } }), facet === "tags" ? "tag" : "folder");
                chip.createSpan({ text: value, attr: { title: value } });
                this.button(chip, t("graphSearch.removeFilter", { value }), () => {
                    const index = Array.from(this.chips.children).indexOf(chip);
                    this.toggleFacet(facet, value);
                    if (this.picker === facet) this.renderChoices();
                    const target = this.chips.children[index]?.querySelector("button")
                        ?? this.chips.children[index - 1]?.querySelector("button") ?? this.facetButtons[facet];
                    target.focus();
                }, "x");
            }
        }
        if (this.chips.childElementCount) {
            this.button(this.chips, t("graphSearch.clearFilters"), () => {
                this.filter = readGraphFilter("");
                this.input.value = "";
                this.applyFilter();
                this.renderChips();
                this.input.focus();
            }).addClass("extended-graph-search-clear-filters");
        }
        this.chips.hidden = !this.chips.childElementCount;
    }

    private facetLabel(facet: GraphFacet) {
        return t(facet === "tags" ? "graphSearch.tags" : "plugin.folders");
    }

    private togglePicker(facet: GraphFacet) {
        const wasOpen = this.picker === facet;
        this.closePanel();
        if (wasOpen) return;
        this.refresh();
        this.picker = facet;
        this.facetButtons[facet].setAttribute("aria-expanded", "true");
        this.choices = this.getChoices(facet);
        const header = this.panel.createDiv("extended-graph-search-panel-header");
        header.createEl("strong", { text: this.facetLabel(facet) });
        header.createSpan({ text: t("graphSearch.facetRule") });
        this.pickerInput = this.panel.createEl("input", {
            type: "search",
            placeholder: t("graphSearch.searchFacet", { facet: this.facetLabel(facet).toLocaleLowerCase() }),
            attr: { "aria-label": t("graphSearch.searchFacet", { facet: this.facetLabel(facet).toLocaleLowerCase() }) }
        });
        this.pickerInput.addEventListener("input", () => this.renderChoices());
        this.panel.createDiv("extended-graph-search-list");
        this.panel.hidden = false;
        this.renderChoices();
        this.pickerInput.focus();
    }

    private getChoices(facet: GraphFacet): [string, number][] {
        const { vault, metadataCache } = ExtendedGraphInstances.app;
        const counts = new Map<string, number>(this.filter[facet].map(value => [value, 0]));
        const add = (value: string) => counts.set(value, (counts.get(value) ?? 0) + 1);
        for (const file of vault.getMarkdownFiles()) {
            if (facet === "tags") {
                const cache = metadataCache.getFileCache(file);
                if (cache) for (const tag of new Set(getAllTags(cache))) add(tag);
            } else {
                let folder = file.parent;
                while (folder && !folder.isRoot()) {
                    add(folder.path);
                    folder = folder.parent;
                }
            }
        }
        return [...counts].sort(([left], [right]) => left.localeCompare(right));
    }

    private renderChoices() {
        if (!this.picker || !this.pickerInput) return;
        const facet = this.picker;
        const list = this.panel.querySelector<HTMLElement>(".extended-graph-search-list")!;
        const query = this.pickerInput.value.trim().toLocaleLowerCase();
        const matches = this.choices.filter(([value]) => value.toLocaleLowerCase().includes(query));
        list.empty();
        list.scrollTop = 0;
        if (!matches.length) {
            list.createDiv({ cls: "extended-graph-search-hint", text: t("graphSearch.noChoices") });
            return;
        }
        for (const [value, count] of matches.slice(0, 120)) {
            const row = list.createEl("button", {
                cls: "extended-graph-search-choice",
                attr: { type: "button", "aria-pressed": String(this.filter[facet].includes(value)) }
            });
            setIcon(row.createSpan("extended-graph-search-check"), "check");
            row.createSpan({ cls: "extended-graph-search-row-label", text: value, attr: { title: value } });
            row.createSpan({
                cls: "extended-graph-search-count",
                text: count.toLocaleString(),
                attr: { title: t("graphSearch.vaultNoteCount") }
            });
            row.addEventListener("click", () => {
                this.toggleFacet(facet, value);
                row.setAttribute("aria-pressed", String(this.filter[facet].includes(value)));
            });
        }
        if (matches.length > 120) {
            list.createDiv({ cls: "extended-graph-search-hint", text: t("graphSearch.moreChoices", { count: matches.length }) });
        }
    }

    private toggleFacet(facet: GraphFacet, value: string) {
        const selected = this.filter[facet];
        this.filter[facet] = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
        this.applyFilter();
        this.renderChips();
    }

    private renderFind() {
        this.closePanel();
        const query = this.findQuery.trim().toLocaleLowerCase();
        if (!query) return;
        const words = query.split(/\s+/u);
        const matches: { file: TFile, score: number }[] = [];
        const { vault } = ExtendedGraphInstances.app;
        for (const node of this.view.renderer.nodes) {
            const file = vault.getAbstractFileByPath(node.id);
            if (!(file instanceof TFile) || file.extension !== "md") continue;
            const basename = file.basename.toLocaleLowerCase();
            const path = file.path.toLocaleLowerCase();
            if (!words.every(word => path.includes(word))) continue;
            const score = basename === query ? 0 : basename.startsWith(query) ? 1 : basename.includes(query) ? 2 : 3;
            matches.push({ file, score });
        }
        matches.sort((a, b) => a.score - b.score || a.file.basename.localeCompare(b.file.basename)
            || a.file.path.localeCompare(b.file.path));
        const header = this.panel.createDiv("extended-graph-search-panel-header");
        header.createEl("strong", { text: t("graphSearch.visibleNotes") });
        header.createSpan({ text: matches.length.toLocaleString(), attr: { role: "status" } });
        const list = this.panel.createDiv("extended-graph-search-list");
        if (!matches.length) {
            list.createDiv({ cls: "extended-graph-search-hint", text: t("controls.noNotesInGraph") });
        }
        for (const { file } of matches.slice(0, 30)) {
            const row = list.createEl("button", { cls: "extended-graph-search-result", attr: { type: "button" } });
            const title = row.createSpan({ cls: "extended-graph-search-row-label", text: file.basename });
            title.createSpan({ cls: "extended-graph-search-path", text: file.path });
            setIcon(row.createSpan({ attr: { "aria-hidden": "true" } }), "locate-fixed");
            row.addEventListener("click", () => this.locate(file));
        }
        if (matches.length > 30) list.createDiv({ cls: "extended-graph-search-hint", text: t("graphSearch.moreNotes") });
        this.panel.hidden = false;
    }

    private locate(file: TFile) {
        if (!this.view.renderer.nodes.some(node => node.id === file.path)) {
            this.renderFind();
            this.input.focus();
            return;
        }
        const manager = ExtendedGraphInstances.graphsManager;
        manager.zoomOnNode(this.view, file.path, this.view.renderer.scale);
        manager.allInstances.get(this.view.leaf.id)?.nodesSet.extendedElementsMap.get(file.path)?.flicker();
        this.closePanel();
        this.input.blur();
    }

    private closePanel() {
        if (this.picker) this.facetButtons[this.picker].setAttribute("aria-expanded", "false");
        this.picker = null;
        this.pickerInput = undefined;
        this.panel.hidden = true;
        this.panel.empty();
        this.choices = [];
    }

    private handlePanelKey(event: KeyboardEvent) {
        if (event.isComposing) return;
        const input = this.pickerInput ?? this.input;
        const target = event.target as HTMLElement;
        if (event.key === "Escape") {
            if (!this.panel.hidden) {
                const focus = this.picker ? this.facetButtons[this.picker] : this.input;
                focus.focus();
                this.closePanel();
            } else if (target === this.input) {
                this.input.blur();
            } else return;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (this.panel.hidden) return;
        const rows = Array.from(this.panel.querySelectorAll<HTMLButtonElement>(".extended-graph-search-list button"));
        const index = rows.indexOf(target as HTMLButtonElement);
        if (target !== input && index < 0) return;
        if (event.key === "ArrowDown" && rows.length) {
            rows[Math.min(index + 1, rows.length - 1)].focus();
        } else if (event.key === "ArrowUp" && index >= 0) {
            (rows[index - 1] ?? input).focus();
        } else if (event.key === "Enter" && target === input && rows[0]) {
            rows[0].click();
        } else return;
        event.preventDefault();
        event.stopPropagation();
    }
}

