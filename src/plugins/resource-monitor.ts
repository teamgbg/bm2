/**
 * @system bm2
 * @status handwritten
 * @edit edit directly

 * Resource monitoring plugin - uses ResourceMonitor for metrics collection.
 */
import { pluginRegistry } from "./registry";
import { ResourceMonitor } from "../resource-monitor";

const resourceMonitor = new ResourceMonitor();

pluginRegistry.registerProcessContainerHooks({
  onMetrics: (metrics, container) => {
    container.memory = metrics.memory;
    container.cpu = metrics.cpu;
    container.handles = metrics.handles;
  },
});

export { resourceMonitor };