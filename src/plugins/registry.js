/**
 * Plugin Registry
 * 
 * Sistema de plugins para renderizar diferentes tipos de datos (value_raw).
 * Cada plugin declara qué datatypes puede renderizar.
 */

class PluginRegistry {
  constructor() {
    this.plugins = new Map();
    this.defaultPlugin = null;
  }

  /**
   * Registra un plugin para un conjunto de datatypes
   * @param {Object} plugin - El plugin a registrar
   * @param {string[]} plugin.datatypes - Array de datatypes que el plugin puede renderizar
   * @param {string} plugin.name - Nombre del plugin
   * @param {Function} plugin.render - Función de renderizado (recibe value, options)
   * @param {Function} plugin.preview - Función de preview corto (opcional)
   * @param {number} plugin.priority - Prioridad del plugin (mayor = más prioritario)
   * @param {Object} plugin.storage - Configuración de almacenamiento en bucket (opcional)
   */
  register(plugin) {
    if (!plugin.datatypes || !Array.isArray(plugin.datatypes)) {
      throw new Error("Plugin must declare datatypes array");
    }

    if (!plugin.name) {
      throw new Error("Plugin must have a name");
    }

    if (!plugin.render || typeof plugin.render !== "function") {
      throw new Error("Plugin must have a render function");
    }

    const pluginEntry = {
      name: plugin.name,
      render: plugin.render,
      preview: plugin.preview || plugin.render,
      priority: plugin.priority || 0,
      options: plugin.options || {},
      storage: plugin.storage || null,
    };

    for (const datatype of plugin.datatypes) {
      const existing = this.plugins.get(datatype);
      
      if (!existing || existing.priority < pluginEntry.priority) {
        this.plugins.set(datatype, pluginEntry);
      }
    }

    return this;
  }

  /**
   * Establece el plugin por defecto para datatypes no registrados
   */
  setDefault(plugin) {
    this.defaultPlugin = {
      name: plugin.name || "default",
      render: plugin.render,
      preview: plugin.preview || plugin.render,
    };
    return this;
  }

  /**
   * Obtiene el plugin para un datatype específico
   */
  getPlugin(datatype) {
    return this.plugins.get(datatype) || this.defaultPlugin;
  }

  /**
   * Renderiza un valor usando el plugin apropiado
   * @param {Object} value - Valor con formato { datatype, data }
   * @param {Object} options - Opciones adicionales de renderizado
   */
  render(value, options = {}) {
    if (!value) return null;

    const datatype = value.datatype || "string";
    const plugin = this.getPlugin(datatype);

    if (!plugin) {
      // Fallback a mostrar el dato como texto
      return String(value.data || value);
    }

    return plugin.render(value.data, { ...options, datatype, fullValue: value });
  }

  /**
   * Renderiza un preview corto del valor
   */
  preview(value, options = {}) {
    if (!value) return null;

    const datatype = value.datatype || "string";
    const plugin = this.getPlugin(datatype);

    if (!plugin) {
      const data = value.data || value;
      const str = String(data);
      return str.length > 50 ? str.substring(0, 50) + "..." : str;
    }

    return plugin.preview(value.data, { ...options, datatype, fullValue: value });
  }

  /**
   * Lista todos los datatypes registrados
   */
  listDatatypes() {
    return Array.from(this.plugins.keys());
  }

  /**
   * Lista todos los plugins registrados
   */
  listPlugins() {
    const seen = new Set();
    const plugins = [];

    for (const [datatype, plugin] of this.plugins) {
      if (!seen.has(plugin.name)) {
        seen.add(plugin.name);
        plugins.push({
          name: plugin.name,
          datatypes: this.getDatatypesForPlugin(plugin.name),
        });
      }
    }

    return plugins;
  }

  /**
   * Obtiene los datatypes que maneja un plugin específico
   */
  getDatatypesForPlugin(pluginName) {
    const datatypes = [];
    for (const [datatype, plugin] of this.plugins) {
      if (plugin.name === pluginName) {
        datatypes.push(datatype);
      }
    }
    return datatypes;
  }

  /**
   * Obtiene la configuración de storage para un datatype
   * @param {string} datatype - Tipo de dato
   * @returns {Object|null} Configuración de storage o null
   */
  getStorageConfig(datatype) {
    const plugin = this.getPlugin(datatype);
    return plugin?.storage || null;
  }

  /**
   * Determina si un valor debe subirse a bucket según la configuración del plugin
   * @param {string} datatype - Tipo de dato
   * @param {string|Object} value - Valor a evaluar
   * @returns {boolean}
   */
  shouldUploadToBucket(datatype, value) {
    const storageConfig = this.getStorageConfig(datatype);
    if (!storageConfig) return false;
    
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);
    const maxChars = storageConfig.maxInlineChars || storageConfig.maxSizeBytes || 10000;
    
    return valueStr.length > maxChars;
  }

  /**
   * Obtiene el bucketId para un datatype
   * @param {string} datatype - Tipo de dato
   * @returns {string|null}
   */
  getBucketId(datatype) {
    const storageConfig = this.getStorageConfig(datatype);
    return storageConfig?.bucketId || null;
  }
}

// Singleton instance
const registry = new PluginRegistry();

export default registry;
export { PluginRegistry };
