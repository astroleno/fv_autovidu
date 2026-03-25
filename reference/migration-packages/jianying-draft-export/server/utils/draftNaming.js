/**
 * 剪映草稿语义化命名工具
 *
 * 将草稿名称从 `templateId-variantId` 格式改为语义化格式
 * 如 `美白精华-护肤模板-年轻女性-居家-温馨`
 */

// 特殊字符正则：剪映草稿名称不允许的字符
const INVALID_CHARS_REGEX = /[\\/:*?"<>|]/g;

// 长度限制配置
const LENGTH_LIMITS = {
  product: 20,
  template: 12,
  variant: 15,
  total: 50,
};

/**
 * 清理并截断单个命名组件
 *
 * @param {string|null|undefined} str - 输入字符串
 * @param {number} maxLength - 最大长度
 * @returns {string} 清理后的字符串
 */
function sanitizeDraftNameComponent(str, maxLength) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  // 移除特殊字符
  let cleaned = str.replace(INVALID_CHARS_REGEX, '');

  // 去除首尾空格
  cleaned = cleaned.trim();

  // 截断到最大长度
  if (maxLength && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return cleaned;
}

/**
 * 构建变体维度字符串
 *
 * @param {Object|null} dimensions - 维度对象 { audience, scene, tone }
 * @param {number} maxLength - 最大总长度
 * @returns {string} 维度字符串，如 "年轻女性-居家-温馨"
 */
function buildVariantDimensionString(dimensions, maxLength) {
  if (!dimensions || typeof dimensions !== 'object') {
    return '';
  }

  const { audience, scene, tone } = dimensions;

  // 过滤空值并收集非空维度
  const parts = [audience, scene, tone]
    .filter(v => v && typeof v === 'string' && v.trim())
    .map(v => v.trim());

  if (parts.length === 0) {
    return '';
  }

  // 清理特殊字符并截断每个部分
  const sanitizedParts = parts.map(p => sanitizeDraftNameComponent(p, LENGTH_LIMITS.variant));

  // 过滤清理后为空的部分
  const validParts = sanitizedParts.filter(p => p);

  if (validParts.length === 0) {
    return '';
  }

  let result = validParts.join('-');

  // 确保总长度不超过限制
  if (maxLength && result.length > maxLength) {
    result = result.slice(0, maxLength);
    // 确保不以不完整的字符结束（截断到最后一个完整的连字符或字符）
    const lastDash = result.lastIndexOf('-');
    if (lastDash > maxLength * 0.5) {
      result = result.slice(0, lastDash);
    }
  }

  return result;
}

/**
 * 构建完整的语义化草稿名称
 *
 * @param {Object} manifest - Manifest 对象
 * @param {string} manifest.productName - 商品名
 * @param {string} manifest.templateName - 模板名
 * @param {Object} manifest.variantDimensions - 变体维度
 * @param {string} manifest.templateId - 模板 ID (回退用)
 * @param {string} manifest.variantId - 变体 ID (回退用)
 * @returns {string} 语义化草稿名称
 */
function buildSemanticDraftName(manifest) {
  const { productName, templateName, variantDimensions, templateId, variantId } = manifest || {};

  // 检查是否有足够的语义数据
  const hasProductName = productName && typeof productName === 'string' && productName.trim();

  // 如果没有商品名，回退到旧格式
  if (!hasProductName) {
    return `${templateId || 'veo'}-${variantId || 'unknown'}`;
  }

  // 构建各部分
  const product = sanitizeDraftNameComponent(productName, LENGTH_LIMITS.product);
  const template = sanitizeDraftNameComponent(templateName, LENGTH_LIMITS.template);
  const dimensions = buildVariantDimensionString(variantDimensions, 30);

  // 组装名称
  const parts = [product, template, dimensions].filter(p => p);
  let name = parts.join('-');

  // 确保总长度限制
  if (name.length > LENGTH_LIMITS.total) {
    name = name.slice(0, LENGTH_LIMITS.total);
  }

  return name;
}

/**
 * 构建唯一草稿 ID（含时间戳）
 *
 * @param {Object} manifest - Manifest 对象
 * @returns {string} 唯一草稿 ID
 */
function buildDraftId(manifest) {
  const timestamp = Date.now();
  const semanticName = buildSemanticDraftName(manifest);

  // 如果语义名称有效（有商品名），使用语义名称作为基础
  const { productName } = manifest || {};
  const hasProductName = productName && typeof productName === 'string' && productName.trim();

  if (hasProductName) {
    // 截断语义名称以确保有时间戳空间
    const maxBaseLength = LENGTH_LIMITS.total - 15; // 为时间戳留空间
    const base = semanticName.slice(0, maxBaseLength);
    return `${base}-${timestamp}`;
  }

  // 回退格式
  const { templateId, variantId } = manifest || {};
  return `${templateId || 'veo'}-${variantId || 'unknown'}-${timestamp}`;
}

module.exports = {
  sanitizeDraftNameComponent,
  buildVariantDimensionString,
  buildSemanticDraftName,
  buildDraftId,
  LENGTH_LIMITS,
};
