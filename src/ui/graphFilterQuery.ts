export type GraphFacet = "tags" | "folders";

export interface GraphFilterQuery {
    text: string;
    tags: string[];
    folders: string[];
}

export const graphFacets: readonly GraphFacet[] = ["tags", "folders"];

function folderTerm(path: string): string {
    const prefix = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return `path:/^${prefix}\\//`;
}

export function buildGraphFilter({ text, tags, folders }: GraphFilterQuery): string {
    const groups: string[] = [];
    if (tags.length) groups.push(`(${tags.map(tag => `tag:${tag}`).join(" OR ")})`);
    if (folders.length) groups.push(`(${folders.map(folderTerm).join(" OR ")})`);
    const query = text.trim();
    if (!groups.length) return query;
    if (query) groups.push(`(${query})`);
    return groups.join(" ");
}

// Read back the groups written by the toolbar. Other native queries remain editable as text.
export function readGraphFilter(query: string): GraphFilterQuery {
    const filter: GraphFilterQuery = { text: "", tags: [], folders: [] };
    const tagTerm = /tag:(#[^\s()"]+)/u;
    const pathTerm = /path:\/\^((?:\\.|[^/\\])+)\\\/\//u;
    let rest = query;
    for (const [facet, term] of [["tags", tagTerm], ["folders", pathTerm]] as const) {
        const group = new RegExp(`^\\((${term.source}(?: OR ${term.source})*)\\)(?: |$)`, "u").exec(rest);
        if (!group) continue;
        filter[facet] = Array.from(group[1].matchAll(new RegExp(term.source, "gu")), match =>
            facet === "tags" ? match[1] : match[1].replace(/\\(.)/gu, "$1"));
        rest = rest.slice(group[0].length);
    }
    if (rest.startsWith("(") && rest.endsWith(")")) filter.text = rest.slice(1, -1);
    if (buildGraphFilter(filter) === query && (filter.tags.length || filter.folders.length)) return filter;
    return { text: query, tags: [], folders: [] };
}
