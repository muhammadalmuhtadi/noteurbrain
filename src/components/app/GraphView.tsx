import { useEffect, useMemo, useRef, useState } from "react";
import { useGraph, useNotebooks, useSections } from "@/hooks/use-notes";
import type { GraphData } from "@/db/types";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function GraphView({ selectedId, onSelect }: Props) {
  const { data, isLoading } = useGraph();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Filters State
  const [notebookFilter, setNotebookFilter] = useState<string>("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [connectionFilter, setConnectionFilter] = useState<string>("all"); // "1", "2", "3", "all"

  // Fetch Notebooks and Sections list for selector dropdowns
  const notebooksQuery = useNotebooks();
  const sectionsQuery = useSections(notebookFilter === "all" ? null : notebookFilter);

  const graph = useMemo(() => data ?? { nodes: [], edges: [], unresolved: [] }, [data]);

  // Compute filtered graph (Notebook/Section filters + BFS connection distance)
  const filteredGraph = useMemo(() => {
    let nodes = graph.nodes;
    let edges = graph.edges;

    // 1. Filter by Notebook
    if (notebookFilter !== "all") {
      nodes = nodes.filter((n) => n.notebook_id === notebookFilter);
    }

    // 2. Filter by Section
    if (sectionFilter !== "all") {
      nodes = nodes.filter((n) => n.section_id === sectionFilter);
    }

    const nodeIds = new Set(nodes.map((n) => n.id));

    // 3. Filter by Connection distance (BFS) if node is selected
    if (selectedId && connectionFilter !== "all" && nodeIds.has(selectedId)) {
      const maxDist = parseInt(connectionFilter, 10);
      const visited = new Set<string>([selectedId]);
      const queue: [string, number][] = [[selectedId, 0]];

      // Build adjacency list for edges between remaining nodes
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
          if (!adj.has(e.source)) adj.set(e.source, []);
          if (!adj.has(e.target)) adj.set(e.target, []);
          adj.get(e.source)!.push(e.target);
          adj.get(e.target)!.push(e.source);
        }
      }

      while (queue.length > 0) {
        const [curr, dist] = queue.shift()!;
        if (dist >= maxDist) continue;

        const neighbors = adj.get(curr) ?? [];
        for (const next of neighbors) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push([next, dist + 1]);
          }
        }
      }

      nodes = nodes.filter((n) => visited.has(n.id));
    }

    const finalNodeIds = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target));

    return { nodes, edges };
  }, [graph, notebookFilter, sectionFilter, connectionFilter, selectedId]);

  // Highlight state refs for performant canvas drawing without re-instantiation
  const highlightedNodes = useRef<Set<string>>(new Set());
  const highlightedLinks = useRef<Set<any>>(new Set());
  const hoverNode = useRef<any>(null);
  const selectedIdRef = useRef<string | null>(selectedId);

  // keep callback refs stable so force-graph closures always see latest values
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Sync selectedId to ref and trigger redraw
  useEffect(() => {
    selectedIdRef.current = selectedId;
    try {
      fgRef.current?.refresh?.();
    } catch {
      /* graph may be mid-teardown */
    }
  }, [selectedId]);

  // Resize observer
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [filteredGraph.nodes.length]); // Re-run when graph nodes appear

  // Update size on change
  useEffect(() => {
    try {
      fgRef.current?.width?.(size.w).height(size.h);
    } catch {
      /* noop */
    }
  }, [size]);

  // Initialize, update, and cleanup graph data
  useEffect(() => {
    if (!wrapRef.current || filteredGraph.nodes.length === 0) return;
    // skip entirely during SSR
    if (import.meta.env.SSR) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const container = wrapRef.current;

    // Convert API nodes/edges to force-graph compatible format
    const nodes = filteredGraph.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      degree: n.degree,
      val: 4 + Math.min(12, n.degree * 1.5), // size weight
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const links = filteredGraph.edges
      .map((e) => ({
        source: nodeMap.get(e.source),
        target: nodeMap.get(e.target),
      }))
      .filter((l) => l.source && l.target);

    // lazy dynamic import of force-graph to support SSR compatibility
    import("force-graph")
      .then((module) => {
        if (!active) return; // component already unmounted before import resolved
        const ForceGraphLib = module.default || module;

        let fg: any;
        try {
          fg = ForceGraphLib()(container)
            .backgroundColor("transparent")
            .width(size.w)
            .height(size.h)
            .linkWidth((link: any) => (highlightedLinks.current.has(link) ? 2 : 1))
            .linkColor((link: any) =>
              highlightedLinks.current.has(link)
                ? "rgba(96, 165, 250, 0.8)" // active blue link
                : "rgba(148, 163, 184, 0.15)" // inactive link
            )
            // directional arrows showing source → target
            .linkDirectionalArrowLength(6)
            .linkDirectionalArrowRelPos(1)
            .linkDirectionalArrowColor((link: any) =>
              highlightedLinks.current.has(link)
                ? "rgba(96, 165, 250, 0.9)"
                : "rgba(148, 163, 184, 0.3)"
            )
            // directional particle flow
            .linkDirectionalParticles((link: any) => (highlightedLinks.current.has(link) ? 4 : 1))
            .linkDirectionalParticleWidth((link: any) => (highlightedLinks.current.has(link) ? 2.5 : 1.5))
            .linkDirectionalParticleSpeed(() => 0.006)
            .onNodeClick((node: any) => {
              if (!active) return;
              try {
                onSelectRef.current(node.id);
              } catch {
                /* noop */
              }
            })
            .onNodeHover((node: any) => {
              if (!active) return;
              try {
                hoverNode.current = node || null;
                highlightedNodes.current.clear();
                highlightedLinks.current.clear();

                if (node) {
                  highlightedNodes.current.add(node.id);
                  links.forEach((link: any) => {
                    const sourceId =
                      link.source && (typeof link.source === "object" ? link.source.id : link.source);
                    const targetId =
                      link.target && (typeof link.target === "object" ? link.target.id : link.target);
                    if (sourceId === node.id || targetId === node.id) {
                      highlightedLinks.current.add(link);
                      if (sourceId) highlightedNodes.current.add(sourceId);
                      if (targetId) highlightedNodes.current.add(targetId);
                    }
                  });
                }
                fg.refresh();
              } catch {
                /* graph may be mid-teardown */
              }
            })
            .nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              try {
                const label = node.title || "Untitled";
                const r = node.val || 4;
                const isSel = node.id === selectedIdRef.current;
                const isHover = hoverNode.current && hoverNode.current.id === node.id;
                const isHighlighted =
                  highlightedNodes.current.size > 0 ? highlightedNodes.current.has(node.id) : true;
                const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

                // Draw node circle
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                ctx.fillStyle = isSel
                  ? "rgba(59, 130, 246, 1)" // blue
                  : isHover
                    ? "rgba(96, 165, 250, 0.9)"
                    : isHighlighted
                      ? isDark
                        ? "rgba(226, 232, 240, 0.8)"
                        : "rgba(71, 85, 105, 0.8)" // slate-200 / slate-600
                      : "rgba(148, 163, 184, 0.15)";
                ctx.fill();

                // Stroke for selected / hover
                if (isSel || isHover) {
                  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
                  ctx.lineWidth = 1.5;
                  ctx.stroke();
                }

                // Draw text label next/below node
                if (globalScale > 0.8 || isSel || isHover) {
                  const fontSize = Math.max(10, 11 / globalScale);
                  ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillStyle = isSel
                    ? "#60a5fa"
                    : isHover
                      ? "#93c5fd"
                      : isHighlighted
                        ? isDark
                          ? "rgba(241, 245, 249, 0.85)"
                          : "rgba(15, 23, 42, 0.85)" // slate-100 / slate-900
                        : "rgba(148, 163, 184, 0.2)";
                  ctx.fillText(label, node.x, node.y + r + fontSize * 0.8);
                }
              } catch {
                /* swallow render errors during teardown */
              }
            });
        } catch (err) {
          console.warn("[GraphView] Failed to initialize force-graph:", err);
          return;
        }

        // Double-check active flag
        if (!active) {
          try {
            fg._destructor?.();
          } catch {
            /* noop */
          }
          container.innerHTML = "";
          return;
        }

        fg.graphData({ nodes, links }).cooldownTicks(80); // run physics ticks initially to settle

        fgRef.current = fg;

        // auto zoom-to-fit on first load
        timer = setTimeout(() => {
          if (active && fgRef.current) {
            try {
              fgRef.current.zoomToFit(400, 40);
            } catch {
              /* noop */
            }
          }
        }, 100);
      })
      .catch((err) => {
        console.warn("[GraphView] force-graph import failed:", err);
      });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      const fg = fgRef.current;
      fgRef.current = null;
      if (fg) {
        try {
          fg._destructor();
        } catch {
          try {
            fg.pauseAnimation?.();
          } catch {
            /* noop */
          }
          try {
            fg.graphData?.({ nodes: [], links: [] });
          } catch {
            /* noop */
          }
        }
      }
      container.innerHTML = "";
    };
  }, [filteredGraph]);

  return (
    <div className="relative flex-1 overflow-hidden bg-background">
      {isLoading ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading graph…
        </div>
      ) : graph.nodes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <p>No notes to graph yet.</p>
          <p className="text-xs">Create notes and link them with @Note Title.</p>
        </div>
      ) : (
        <>
          {/* Visual Filters Panel */}
          <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card/90 backdrop-blur-md p-3 shadow-lg max-w-[calc(100%-2rem)]">
            {/* Notebook Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">
                Notebook
              </label>
              <select
                value={notebookFilter}
                onChange={(e) => {
                  setNotebookFilter(e.target.value);
                  setSectionFilter("all"); // reset section when notebook changes
                }}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring min-w-[110px]"
              >
                <option value="all">All Notebooks</option>
                {notebooksQuery.data?.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Section Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">
                Section
              </label>
              <select
                value={sectionFilter}
                disabled={notebookFilter === "all"}
                onChange={(e) => setSectionFilter(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 min-w-[110px]"
              >
                <option value="all">All Sections</option>
                {sectionsQuery.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Connection Separation Filter */}
            <div className="flex flex-col gap-1 min-w-[120px]">
              <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">
                Distance filter
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min="1"
                  max="4"
                  value={connectionFilter === "all" ? "4" : connectionFilter}
                  disabled={!selectedId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConnectionFilter(val === "4" ? "all" : val);
                  }}
                  className="w-20 accent-primary disabled:opacity-50 h-1.5 rounded-lg appearance-none bg-muted cursor-pointer"
                />
                <span className="text-[10px] font-semibold select-none text-muted-foreground">
                  {!selectedId
                    ? "Select note"
                    : connectionFilter === "all"
                      ? "All links"
                      : `${connectionFilter} link${connectionFilter !== "1" ? "s" : ""}`}
                </span>
              </div>
            </div>

            {/* Clear Filters Button */}
            {(notebookFilter !== "all" || sectionFilter !== "all" || connectionFilter !== "all") && (
              <button
                onClick={() => {
                  setNotebookFilter("all");
                  setSectionFilter("all");
                  setConnectionFilter("all");
                }}
                className="h-7 px-2.5 rounded-md text-[10px] font-semibold bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors self-end mt-1.5 animate-in fade-in zoom-in duration-200"
              >
                Reset
              </button>
            )}
          </div>

          <div ref={wrapRef} className="w-full h-full" />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border bg-card/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur z-10">
            {filteredGraph.nodes.length} nodes · {filteredGraph.edges.length} links
            {graph.unresolved.length > 0 && ` · ${graph.unresolved.length} unresolved`}
          </div>
          <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-border bg-card/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur z-10">
            Drag nodes · Scroll/pinch to zoom · Click to open
          </div>
        </>
      )}
    </div>
  );
}
