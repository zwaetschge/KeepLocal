import React,{useEffect,useRef,useState} from 'react';
import {useLanguage} from '../contexts/LanguageContext';
import SearchBar from './SearchBar';
import Logo from './Logo';
import KeepIcon from './KeepIcon';
import {AppearanceDialog} from './AppearanceSettings';
export default function KeepHeader({user,searchTerm,onSearch,searchRef,onSearchFocus,onSearchDismiss,onMenu,isMobileOpen,collapsed,onRefresh,refreshing,settings,onSettings,onPreferences,onLogout}) {
  const {t}=useLanguage();const account=useRef(null);const [showAppearance,setShowAppearance]=useState(false);
  const openSettings=()=>{account.current?.removeAttribute('open');if(user?.isDemo)setShowAppearance(true);else onSettings();};
  useEffect(()=>{
    const dismiss=e=>{if(e.key==='Escape'||(e.type==='pointerdown'&&!account.current?.contains(e.target)))account.current?.removeAttribute('open');};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',dismiss);
    return ()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',dismiss);};
  },[]);
  const action=(name,label,onClick,extra={})=><button type="button" className="keep-header-action" aria-label={label} title={label} onClick={onClick} {...extra}><KeepIcon name={name}/></button>;
  return <><header className="App-header"><div className="header-content">
    <button type="button" className="desktop-menu-toggle keep-header-action" onClick={onMenu} aria-label={t('openMenu')} aria-expanded={!collapsed} aria-controls="app-sidebar"><KeepIcon name="menu"/></button>
    <button type="button" className="mobile-menu-toggle keep-header-action" onClick={onMenu} aria-label={t('openMenu')} aria-expanded={isMobileOpen} aria-controls="app-sidebar"><KeepIcon name="menu"/></button>
    <Logo size={32}/>
    <SearchBar onSearch={onSearch} searchTerm={searchTerm} ref={searchRef} onFocus={onSearchFocus} onDismiss={onSearchDismiss}/>
    <div className="keep-header-actions">
      {action('refresh',t('layoutRefresh'),onRefresh,{'aria-busy':refreshing})}
      {action(settings.viewMode==='list'?'grid':'list',t(settings.viewMode==='list'?'keepGrid':'keepList'),()=>onPreferences({viewMode:settings.viewMode==='list'?'grid':'list'}))}
      {action('settings',t('settings'),openSettings)}
      <details ref={account} className="keep-account"><summary aria-label={t('layoutAccount')} title={user?.username}><span>{(user?.username||'K').slice(0,1).toUpperCase()}</span></summary>
        <div className="keep-account-panel"><strong>{user?.username}</strong><span>{user?.email}</span><button type="button" onClick={openSettings}>{t('settings')}</button><button type="button" onClick={onLogout}>{t('logout')}</button></div>
      </details>
    </div>
  </div></header>{showAppearance && <AppearanceDialog onClose={()=>setShowAppearance(false)}/>}</>;
}
