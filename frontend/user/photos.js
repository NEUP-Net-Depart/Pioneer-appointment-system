import { compressImage } from '/shared/image-compress.js';
import { uploadAttachments,attachmentSize } from '/shared/attachments.js';
import { escapeHtml } from '/shared/utils.js';
import { dialogController } from './dialogs.js';
const photoDialog=dialogController(document.querySelector('#photo-modal'));
document.querySelector('#close-photo').addEventListener('click',()=>photoDialog.close());
export function previewPhoto(url){document.querySelector('#photo-large').src=url;photoDialog.open();}
export function createPhotoCollection(root,{inputId,existingCount=()=>0,onChange=()=>{},onUploadChange=()=>{}}={}) {
  root.classList.add('photo-collection');
  let entries=[],disposed=false,paused=false,uploadTask,collectionVersion=0;
  const grid=document.createElement('div');grid.className='photo-grid';
  const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';input.hidden=true;if(inputId)input.id=inputId;
  const add=document.createElement('button');add.type='button';add.className='secondary-btn';add.textContent='添加照片';
  const error=document.createElement('p');error.className='field-error';error.setAttribute('role','alert');
  root.replaceChildren(grid,input,add,error);
  const revoke=entry=>{if(entry.url)URL.revokeObjectURL(entry.url);entry.url='';};
  function render() {
    if(disposed)return;
    grid.innerHTML=entries.map(entry=>`<article class="photo-card" data-photo="${entry.id}">${entry.url ? `<button type="button" class="photo-preview-button" data-preview="${entry.id}" aria-label="预览 ${escapeHtml(entry.name)}"><img src="${entry.url}" alt="${escapeHtml(entry.name)}" /></button>` : '<div class="photo-preview-placeholder" aria-hidden="true"></div>'}<p>${escapeHtml(entry.name)}</p><p class="${entry.state==='error' ? 'is-error' : ''}" role="status">${escapeHtml(entry.message)}</p>${entry.state==='preparing' ? `<progress max="100" value="${entry.progress}" aria-label="照片准备进度"></progress>` : entry.state==='uploading' ? '<progress aria-label="照片上传进度"></progress>' : ''}<div class="photo-controls"><button type="button" class="text-btn" data-replace="${entry.id}"${entry.state==='uploading' || entry.attachment ? ' disabled' : ''}>替换</button><button type="button" class="text-btn" data-delete="${entry.id}"${entry.state==='uploading' || entry.attachment ? ' disabled' : ''}>删除</button></div></article>`).join('');
    add.disabled=entries.filter(entry=>!entry.attachment).length+existingCount()>=4;
  }
  async function prepare(entry,file) {
    const version=++entry.version;entry.state='preparing';entry.message='正在准备照片…';entry.file=null;entry.name=file.name;entry.progress=0;revoke(entry);render();onChange();
    const current=()=>!disposed && entries.includes(entry) && version===entry.version;
    try {
      const prepared=await compressImage(file,{strict:true,onProgress({value,label}){if(!current())return;entry.progress=value;entry.message=label;render();}});
      if(!current())return;
      entry.file=prepared.file;entry.url=URL.createObjectURL(prepared.file);entry.state='ready';entry.message=`照片已准备好 · ${attachmentSize(prepared.file.size)}`;
    } catch(failure){if(!current())return;entry.state='error';entry.message=failure.message;}
    render();onChange();
  }
  input.addEventListener('change',()=>{
    const files=[...input.files];input.value='';const remaining=4-existingCount()-entries.filter(entry=>!entry.attachment).length;
    if(files.length>remaining){error.textContent=`最多 4 张照片，还可添加 ${Math.max(0,remaining)} 张。请重新选择，没有照片被添加。`;return;}
    error.textContent='';
    for(const file of files){const entry={id:crypto.randomUUID(),version:0,name:file.name,state:'preparing',message:'正在准备照片…',progress:0};entries.push(entry);void prepare(entry,file);}
    render();
  });
  add.addEventListener('click',()=>input.click());
  grid.addEventListener('click',event=>{
    const control=event.target.closest('[data-preview],[data-delete],[data-replace]');if(!control)return;
    const id=control.dataset.preview || control.dataset.delete || control.dataset.replace,entry=entries.find(item=>item.id===id);if(!entry)return;
    if(control.dataset.preview){previewPhoto(entry.url);return;}
    if(entry.attachment || entry.state==='uploading')return;
    if(control.dataset.delete){entry.version++;revoke(entry);entries=entries.filter(item=>item!==entry);error.textContent='';render();onChange();return;}
    const replacement=document.createElement('input');replacement.type='file';replacement.accept=input.accept;replacement.hidden=true;root.append(replacement);
    replacement.addEventListener('change',()=>{const file=replacement.files[0];if(file && entries.includes(entry))void prepare(entry,file);replacement.remove();},{once:true});replacement.click();
  });
  function validity() {
    const invalid=entries.find(entry=>entry.state==='error' || entry.state==='preparing');
    if(invalid){root.closest('.device-panel')?.dispatchEvent(new Event('device-reveal'));error.textContent=invalid.state==='preparing' ? '照片正在准备，请稍候再继续。' : '有照片准备失败，请替换或删除后继续。';add.focus();return false;}
    error.textContent='';return true;
  }
  async function uploadAll(appointment) {
    if(uploadTask)return uploadTask;
    paused=false;const currentVersion=collectionVersion;
    uploadTask=(async()=>{
      for(const entry of entries){
        if(disposed || paused || currentVersion!==collectionVersion)break;
        if(entry.attachment || !entry.file)continue;
        entry.state='uploading';entry.message='正在上传…';onUploadChange(entries);render();
        try {const [attachment]=await uploadAttachments(appointment,[entry.file],'student_photo');if(disposed || currentVersion!==collectionVersion || !entries.includes(entry))return;entry.attachment=attachment;entry.state='uploaded';entry.message='已上传';}
        catch(failure){if(disposed || currentVersion!==collectionVersion || !entries.includes(entry))return;entry.state='upload-error';entry.message=failure.message || '上传失败，请重试。';}
        render();onUploadChange(entries);
      }
    })();
    try {await uploadTask;} finally {if(currentVersion===collectionVersion && !disposed){uploadTask=undefined;onUploadChange(entries);}}
  }
  return {validity,uploadAll,entries:()=>entries,pauseUpload(){paused=true;},refresh:render,
    reset(){collectionVersion++;uploadTask=undefined;paused=true;for(const entry of entries){entry.version++;revoke(entry);}entries=[];input.value='';error.textContent='';render();},
    dispose(){collectionVersion++;disposed=true;paused=true;entries.forEach(entry=>{entry.version++;revoke(entry);});root.replaceChildren();}
  };
}
