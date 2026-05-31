/* SPDX-License-Identifier: Apache-2.0 */
/** Browser-side Lightning wait helpers for SF Browser. */

export type LightningWaitModeValue =
  | "app-ready"
  | "navigation-ready"
  | "record-view"
  | "modal-open"
  | "modal-closed"
  | "toast"
  | "spinner-gone"
  | "save-result";

export type LightningWaitOutcome =
  | "app-ready"
  | "navigation-ready"
  | "record-view"
  | "modal-open"
  | "modal-closed"
  | "toast"
  | "spinner-gone"
  | "success-toast"
  | "error-toast"
  | "validation-error"
  | "classic-error"
  | "classic-success"
  | "ambiguous";

export interface LightningOutcomeDetails {
  outcome: LightningWaitOutcome;
  matched?: { selector?: string; text?: string; url?: string };
}

export function buildLightningWaitExpression(mode: LightningWaitModeValue): string {
  return `(() => { ${LIGHTNING_WAIT_HELPERS} return window.__sfPiLightningWait(${JSON.stringify(mode)}); })()`;
}

export function buildLightningOutcomeExpression(mode: LightningWaitModeValue): string {
  return `(() => { ${LIGHTNING_WAIT_HELPERS} return JSON.stringify(window.__sfPiLightningOutcome(${JSON.stringify(mode)})); })()`;
}

export const LIGHTNING_WAIT_HELPERS = String.raw`
function visible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}
function firstVisible(selectors) {
  for (const selector of selectors) {
    const found = Array.from(document.querySelectorAll(selector)).find(visible);
    if (found) return { el: found, selector };
  }
  return null;
}
function textOf(el) {
  return (el && (el.innerText || el.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 500);
}
function lightningShellVisible() {
  return firstVisible([
    'div.desktop.container',
    'div.oneContent',
    'one-app',
    '.setupcontent',
    'setup-root',
    'div[data-aura-rendered-by]',
    '.slds-template__container'
  ]);
}
function recordViewMatch() {
  const withObject = location.pathname.match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view/);
  if (withObject) return { selector: 'location.pathname', url: location.pathname };
  const idOnly = location.pathname.match(/\/lightning\/r\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view/);
  if (idOnly) return { selector: 'location.pathname', url: location.pathname };
  return null;
}
function modalVisible() {
  return firstVisible([
    '[role="dialog"]',
    '.slds-modal__container',
    '.slds-modal',
    '.uiModal',
    '.modal-container',
    'lightning-modal'
  ]);
}
function toastVisible() {
  return firstVisible([
    '.slds-notify_toast',
    '.slds-notify.slds-notify_toast',
    '.forceToastMessage',
    '[data-aura-class*="forceToastMessage"]',
    '.toastMessage',
    '[role="status"].slds-notify',
    '[role="alert"].slds-notify',
    'lightning-toast'
  ]);
}
function spinnerVisible() {
  return firstVisible([
    '.slds-spinner_container',
    '.slds-spinner',
    '.slds-is-loading',
    '.lafPageHostLoading',
    'lightning-spinner',
    'lightning-primitive-spinner',
    '[role="progressbar"]',
    '[aria-busy="true"]'
  ]);
}
function stencilVisible() {
  return firstVisible([
    '.stencil',
    '[class*="stencil"]',
    '.slds-skeleton',
    '[class*="skeleton"]'
  ]);
}
function blockingBackdropVisible() {
  return firstVisible([
    '.slds-backdrop_open',
    '.slds-backdrop.slds-backdrop_open',
    '.modal-backdrop',
    '.uiBlockUI'
  ]);
}
function validationVisible() {
  return firstVisible([
    '[aria-invalid="true"]',
    '.slds-has-error',
    '.slds-form-element__help',
    '.fieldLevelErrors',
    '[data-error-message]',
    '[part="error-message"]',
    'lightning-input-field.slds-has-error',
    '[data-aura-class*="error"]'
  ]);
}
function classicErrorVisible() {
  return firstVisible(['#error', '.errorMsg', '.message.errorM3', '.pbError', '.error']);
}
function visibleSaveButton() {
  return Array.from(document.querySelectorAll('input, button')).find(function(el) {
    if (!visible(el)) return false;
    const label = textOf(el) || el.value || el.getAttribute('title') || '';
    return /^\s*save\s*$/i.test(label);
  });
}
function classicSetupSuccess() {
  if (!/\/lightning\/setup\//.test(location.pathname)) return null;
  if (modalVisible() || spinnerVisible() || validationVisible() || classicErrorVisible() || visibleSaveButton()) return null;
  if (!textOf(document.body)) return null;
  return { selector: 'location.pathname', url: location.pathname };
}
function bodyHasErrorText() {
  const text = textOf(document.body);
  if (/please fix the following|review the errors|complete this field|required field|invalid value|unable to save|problem saving/i.test(text)) {
    return { selector: 'body', text };
  }
  return null;
}
function quickActionMatch() {
  if (!/\/lightning\/action\/quick\//.test(location.pathname)) return null;
  if (!textOf(document.body)) return null;
  return { selector: 'location.pathname', url: location.pathname };
}
function appReady() {
  if (document.readyState === 'loading' || !document.body) return null;
  const shell = lightningShellVisible() || quickActionMatch();
  if (!shell) return null;
  if (spinnerVisible()) return null;
  if (stencilVisible()) return null;
  if (blockingBackdropVisible() && !modalVisible()) return null;
  if (!textOf(document.body)) return null;
  return { selector: shell.selector };
}
function isAuthRedirectUrl(href) {
  return /frontdoor\.jsp|contentDoor|\/secur\//i.test(href) || /^https?:\/\/login\./i.test(href) || /file\.force\.com/i.test(href);
}
function navigationReady() {
  const ready = appReady();
  if (!ready) return null;
  const href = location.href;
  if (isAuthRedirectUrl(href)) {
    window.__sfPiNavigationReadyState = { lastHref: href, stableTicks: 0 };
    return null;
  }
  const previous = window.__sfPiNavigationReadyState || { lastHref: '', stableTicks: 0 };
  const stableTicks = previous.lastHref === href ? previous.stableTicks + 1 : 0;
  window.__sfPiNavigationReadyState = { lastHref: href, stableTicks };
  if (stableTicks < 2) return null;
  return { selector: ready.selector, url: location.pathname };
}
function classifySaveResult() {
  const toast = toastVisible();
  if (toast) {
    const text = textOf(toast.el);
    if (/error|failed|can't|cannot|invalid|unable|problem/i.test(text)) return { outcome: 'error-toast', matched: { selector: toast.selector, text } };
    return { outcome: 'success-toast', matched: { selector: toast.selector, text } };
  }
  const validation = validationVisible();
  if (validation) return { outcome: 'validation-error', matched: { selector: validation.selector, text: textOf(validation.el) } };
  const bodyError = bodyHasErrorText();
  if (bodyError) return { outcome: 'validation-error', matched: bodyError };
  const classic = classicErrorVisible();
  if (classic) return { outcome: 'classic-error', matched: { selector: classic.selector, text: textOf(classic.el) } };
  const record = recordViewMatch();
  if (record) return { outcome: 'record-view', matched: record };
  const classicSuccess = classicSetupSuccess();
  if (classicSuccess) return { outcome: 'classic-success', matched: classicSuccess };
  return { outcome: 'ambiguous' };
}
window.__sfPiLightningOutcome = function(mode) {
  if (mode === 'save-result') return classifySaveResult();
  if (mode === 'app-ready') {
    const ready = appReady();
    return ready ? { outcome: 'app-ready', matched: ready } : { outcome: 'ambiguous' };
  }
  if (mode === 'navigation-ready') {
    const ready = navigationReady();
    return ready ? { outcome: 'navigation-ready', matched: ready } : { outcome: 'ambiguous' };
  }
  if (mode === 'record-view') {
    const record = recordViewMatch();
    return record ? { outcome: 'record-view', matched: record } : { outcome: 'ambiguous' };
  }
  if (mode === 'modal-open') {
    const modal = modalVisible();
    return modal ? { outcome: 'modal-open', matched: { selector: modal.selector, text: textOf(modal.el) } } : { outcome: 'ambiguous' };
  }
  if (mode === 'modal-closed') return !modalVisible() ? { outcome: 'modal-closed' } : { outcome: 'ambiguous' };
  if (mode === 'toast') {
    const toast = toastVisible();
    return toast ? { outcome: 'toast', matched: { selector: toast.selector, text: textOf(toast.el) } } : { outcome: 'ambiguous' };
  }
  if (mode === 'spinner-gone') return !spinnerVisible() ? { outcome: 'spinner-gone' } : { outcome: 'ambiguous' };
  return { outcome: 'ambiguous' };
};
window.__sfPiLightningWait = function(mode) {
  const outcome = window.__sfPiLightningOutcome(mode).outcome;
  return outcome !== 'ambiguous';
};
`;
