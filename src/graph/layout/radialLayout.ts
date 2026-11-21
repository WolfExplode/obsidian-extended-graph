import { getLinkpath } from "obsidian";
import type { GraphData } from "obsidian-typings";
import { getFile } from "../../helpers/vault";
import { ExtendedGraphInstances, type GraphInstances } from "../../pluginInstances";
import type { RadialLinkSettings } from "../../settings/settings";
import { buildRadialForest, selectAdditionalParents } from "./radialTree";
import { RadialPhysics } from "./radialPhysics";

type Position = { x: number; y: number };
export const DEFAULT_RADIAL_SPACING = 220;

export class RadialLayout {
    active = false;
    spacing = DEFAULT_RADIAL_SPACING;
    private positions = new Map<string, Position>();
    private descendants = new Map<string, number>();
    private physics = new RadialPhysics();
    private camera?: { x: number; y: number; scale: number };
    private mutedWorker?: { worker: Worker; onMessage: Worker["onmessage"] };
    private fitOnRender = false;

    constructor(private instances: GraphInstances) {}

    get animate() {
        const win = this.instances.renderer.interactiveEl.ownerDocument.defaultView;
        return ExtendedGraphInstances.settings.radialMotion ?? !win?.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    getDescendantCount(id: string): number | undefined {
        if (ExtendedGraphInstances.settings.radialNodeSizing[this.instances.type] === "descendants") {
            return this.descendants.get(id);
        }
    }

    setAutomatic() {
        if (this.active) return;
        const renderer = this.instances.renderer;
        this.camera = { x: renderer.panX, y: renderer.panY, scale: renderer.scale };
        this.active = true;
        this.refresh(true);
    }

    refresh(fit = false) {
        if (!this.active) return;
        this.fitOnRender ||= fit;
        this.instances.engine.render();
    }

    clear() {
        if (!this.active) return;
        this.release();
        this.instances.engine.render();
    }

    release() {
        if (!this.active) return;
        const renderer = this.instances.renderer;
        this.restoreWorker();
        renderer.worker.postMessage({ alpha: 0.3, run: true });
        if (this.camera) {
            renderer.setPan(this.camera.x, this.camera.y);
            renderer.setScale(this.camera.scale);
            renderer.zoomTo(this.camera.scale, { x: 0, y: 0 });
        }
        this.camera = undefined;
        this.fitOnRender = false;
        this.active = false;
        this.positions.clear();
        this.descendants.clear();
        this.physics = new RadialPhysics();
        renderer.changed();
    }

    filter(data: GraphData): GraphData {
        if (!this.active) return data;
        const { radialLinks } = ExtendedGraphInstances.settings;
        const linkSettings = radialLinks[this.instances.type];
        let { hierarchy } = linkSettings;
        const firstChildren = hierarchy === "parents" && linkSettings.parentSelection === "first"
            ? new Map<string, string[]>() : undefined;
        let children = this.collectChildren(data.nodes, hierarchy, firstChildren);
        if (hierarchy === "parents" && !children.size) {
            hierarchy = "outgoing";
            children = this.collectChildren(data.nodes, hierarchy);
        }
        const candidates = hierarchy === "parents" && firstChildren ? firstChildren : children;
        const { parents, positions, tiers, descendants } = buildRadialForest(Object.keys(data.nodes), candidates, this.spacing);
        this.descendants = descendants;
        const { additionalParents, declaredParents } = hierarchy === "parents"
            ? selectAdditionalParents(children, parents, tiers, linkSettings.parentSelection, candidates)
            : { additionalParents: new Map<string, Set<string>>(), declaredParents: undefined };
        if (!this.positions.size) this.fitOnRender = true;
        this.positions = positions;
        this.physics.configure(positions, parents, additionalParents, this.spacing);
        const isParent = (child: string, parent: string) =>
            parents.get(child) === parent || additionalParents.get(child)?.has(parent);
        const nodes: GraphData["nodes"] = Object.create(null);
        for (const id of positions.keys()) {
            const source = data.nodes[id];
            const links: typeof source.links = Object.create(null);
            for (const [target, value] of Object.entries(source.links)) {
                if (!positions.has(target)) continue;
                const preferredDirection = hierarchy === "parents" ? isParent(id, target) : isParent(target, id);
                const otherDirection = hierarchy === "parents" ? isParent(target, id) : isParent(id, target);
                const declaredDirection = declaredParents?.get(id)?.has(target);
                const rejectedParent = !preferredDirection && (otherDirection
                    ? firstChildren && declaredDirection && Object.hasOwn(data.nodes[target].links, id)
                    : declaredDirection || declaredParents?.get(target)?.has(id));
                if ((linkSettings.showCrossLinks && !rejectedParent) || preferredDirection ||
                    (otherDirection && !Object.hasOwn(data.nodes[target].links, id))) {
                    links[target] = value;
                }
            }
            nodes[id] = { ...source, links };
        }
        return { ...data, nodes };
    }

    private collectChildren(
        nodes: GraphData["nodes"], hierarchy: RadialLinkSettings["hierarchy"], firstChildren?: Map<string, string[]>
    ) {
        const children = new Map<string, string[]>();
        if (hierarchy === "outgoing") {
            for (const [id, node] of Object.entries(nodes)) {
                if (getFile(id)?.extension !== "md") continue;
                children.set(id, Object.keys(node.links)
                    .filter(target => Object.hasOwn(nodes, target) && getFile(target)?.extension === "md").sort());
            }
        } else {
            const { metadataCache } = ExtendedGraphInstances.app;
            for (const id of Object.keys(nodes)) {
                const file = getFile(id);
                const links = file && metadataCache.getFileCache(file)?.frontmatterLinks;
                if (!links?.length) continue;
                // Obsidian uses an unsuffixed key for a scalar and a zero-based suffix for a list.
                const firstLink = firstChildren && links.find(link => /^parent(?:\.0)?$/i.test(link.key));
                const seenParents = new Set<string>();
                for (const link of links) {
                    if (link.key.split(".")[0].toLowerCase() !== "parent") continue;
                    const parent = metadataCache.getFirstLinkpathDest(getLinkpath(link.link), id)?.path;
                    if (!parent || parent === id || !Object.hasOwn(nodes, parent)) continue;
                    if (!Object.hasOwn(nodes[id].links, parent) && !Object.hasOwn(nodes[parent].links, id)) continue;
                    if (firstChildren && link === firstLink) {
                        if (!firstChildren.has(parent)) firstChildren.set(parent, []);
                        firstChildren.get(parent)!.push(id);
                    }
                    if (seenParents.has(parent)) continue;
                    seenParents.add(parent);
                    if (!children.has(parent)) children.set(parent, []);
                    children.get(parent)!.push(id);
                }
            }
            for (const ids of children.values()) ids.sort();
            if (firstChildren) for (const ids of firstChildren.values()) ids.sort();
        }
        return children;
    }

    apply(advance = false) {
        if (!this.positions.size) return;
        const renderer = this.instances.renderer;
        // Use Obsidian's interaction and drawing code while this layout supplies positions.
        if (this.mutedWorker?.worker !== renderer.worker) {
            this.restoreWorker();
            this.mutedWorker = { worker: renderer.worker, onMessage: renderer.worker.onmessage };
            renderer.worker.onmessage = null;
        }
        const workerState: { workerResults: typeof renderer.workerResults | null } = renderer;
        workerState.workerResults = null;
        let moved = this.physics.sync(renderer.nodes, this.positions);
        if (advance) {
            if (this.animate) moved = this.physics.step(renderer.nodes) || moved;
            else if (!renderer.dragNode) moved = this.physics.step(renderer.nodes, 48) || moved;
        }
        if (this.fitOnRender && renderer.width && renderer.height) {
            this.fitOnRender = false;
            this.fit();
            moved = true;
        }
        if (moved) renderer.changed();
    }

    private restoreWorker() {
        if (!this.mutedWorker) return;
        const { worker, onMessage } = this.mutedWorker;
        worker.onmessage = onMessage;
        this.mutedWorker = undefined;
    }

    private fit() {
        const { renderer } = this.instances;
        const dpr = renderer.interactiveEl.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (const { x, y } of renderer.nodes) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
        if (!renderer.nodes.length) return;
        const scale = Math.max(1 / 128, Math.min(1,
            renderer.width * dpr / (right - left + 200), renderer.height * dpr / (bottom - top + 200)));
        renderer.setPan(renderer.width * dpr / 2 - (left + right) * scale / 2,
            renderer.height * dpr / 2 - (top + bottom) * scale / 2);
        renderer.setScale(scale);
        renderer.zoomTo(scale, { x: 0, y: 0 });
    }
}
