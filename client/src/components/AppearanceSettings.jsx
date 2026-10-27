import React from 'react';
import {useSettings} from '../contexts/SettingsContext';
import {useModalA11y} from '../hooks/useModalA11y';
import {useBackdropClose} from '../hooks/useBackdropClose';
import {useLanguage} from '../contexts/LanguageContext';
export default function AppearanceSettings(){
 const {settings,updateSettings}=useSettings();const {t}=useLanguage();
 return <section className="settings-section appearance-settings"><h3 className="settings-section-title">{t('layoutDesign')}</h3>
  <label>{t('layoutTheme')}<select value={settings.theme} onChange={e=>updateSettings({theme:e.target.value})}>
   {['light','dark','oled','eink','doodle'].map(theme=><option key={theme} value={theme}>{t(`layoutTheme_${theme}`)}</option>)}
  </select></label>
  <label>{t('layoutSurface')}<select value={settings.visualStyle} onChange={e=>updateSettings({visualStyle:e.target.value})}>
   <option value="classic">{t('layoutClassic')}</option><option value="keep">{t('keepQuietStyle')}</option>
  </select></label><p className="settings-section-description">{t('layoutDesignHint')}</p>
 </section>;
}

export function AppearanceDialog({onClose}) {
 const {t}=useLanguage();const {containerRef,titleId}=useModalA11y({onClose});const backdrop=useBackdropClose(onClose);
 return <div className="label-manager-overlay" {...backdrop}><div className="appearance-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={containerRef} tabIndex={-1} onClick={e=>e.stopPropagation()}>
  <h2 id={titleId}>{t('layoutDesign')}</h2><AppearanceSettings/><button type="button" onClick={onClose}>{t('close')}</button>
 </div></div>;
}
