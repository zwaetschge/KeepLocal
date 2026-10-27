import React from 'react';
import KeepIcon from './KeepIcon';
import { useLanguage } from '../contexts/LanguageContext';
const palette = [
  '#ffffff',
  '#f28b82',
  '#fbbc04',
  '#fff475',
  '#ccff90',
  '#a7ffeb',
  '#cbf0f8',
  '#aecbfa',
  '#d7aefb',
  '#fdcfe8',
  '#e6c9a8',
  '#e8eaed',
];
export default function NotesToolbar({filters,onFilter,tags,selectedTag,onTag,people,open,onOpen,onClose}) {
  const {t}=useLanguage();
  const active=Object.values(filters).some(Boolean)||selectedTag;
  if(!open&&!active)return null;
  return <section className={`notes-toolbar ${open?'search-discovery':'active-filters'}`} aria-label={t('keepFilters')}>
    {open ? <>
      <div className="discovery-heading"><h2>{t('layoutTypes')}</h2><button type="button" onClick={onClose} aria-label={t('close')}><KeepIcon name="close"/></button></div>
      <div className="discovery-types">{['reminders','lists','images','text','drawings','audio','pinned'].map(type=><button type="button" key={type} aria-pressed={filters.type===type} onClick={()=>onFilter({...filters,type})}><KeepIcon size={30} name={({reminders:'reminder',lists:'checklist',images:'image',text:'note',drawings:'edit',audio:'note',pinned:'note'})[type]}/><span>{t(`keepType_${type}`)}</span></button>)}</div>
      {tags.length>0&&<><h2>{t('layoutLabels')}</h2><div className="discovery-labels">{tags.map(tag=><button type="button" key={tag.name||tag} onClick={()=>onTag(tag.name||tag)}><KeepIcon name="label"/>{tag.name||tag}</button>)}</div></>}
      <h2>{t('keepColor')}</h2><div className="discovery-colors">{palette.map((color,i)=><button type="button" key={color} style={{backgroundColor:color}} title={t(`keepColor${i}`)} aria-label={t(`keepColor${i}`)} aria-pressed={filters.color===color} onClick={()=>onFilter({...filters,color})}/>)}</div>
      {people.length>0&&<><h2>{t('keepPerson')}</h2><div className="discovery-labels">{people.map(person=><button type="button" key={person._id||person.id} onClick={()=>onFilter({...filters,person:person._id||person.id})}>{person.username}</button>)}</div></>}
    </> : <>
      {filters.type&&<button type="button" onClick={onOpen}>{t(`keepType_${filters.type}`)}</button>}
      {selectedTag&&<button type="button" onClick={onOpen}><KeepIcon name="label" size={16}/>{selectedTag}</button>}
      {filters.color&&<button type="button" onClick={onOpen}><span className="filter-color" style={{background:filters.color}}/>{t('keepColor')}</button>}
      {filters.person&&<button type="button" onClick={onOpen}>{people.find(p=>(p._id||p.id)===filters.person)?.username||t('keepPerson')}</button>}
    </>}
    {active&&<button type="button" className="filters-reset" onClick={()=>{onFilter({});onTag(null);}}>{t('keepReset')}</button>}
  </section>;
}
