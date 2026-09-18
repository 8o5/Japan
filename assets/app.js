
const sectionPicker=document.querySelector('#section-picker');
sectionPicker.addEventListener('change',()=>{location.hash=sectionPicker.value;});
const navLinks=[...document.querySelectorAll('.nav a')];
const sections=[...document.querySelectorAll('.day,.booking-section')];
let framePending=false;
function updateSection(){
 const line=Math.min(260,innerHeight*.4); let current=sections[0];
 for(const section of sections){if(section.getBoundingClientRect().top<=line)current=section;}
 if(current){const hash='#'+current.id;
 navLinks.forEach(a=>{const active=a.hash===hash;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
 if(document.activeElement!==sectionPicker)sectionPicker.value=hash;
 }framePending=false;
}
addEventListener('scroll',()=>{if(!framePending){framePending=true;requestAnimationFrame(updateSection);}},{passive:true});
addEventListener('hashchange',updateSection);addEventListener('load',updateSection);updateSection();
const finder=document.querySelector('.stop-finder');
const search=document.querySelector('#stop-search');
const choices=[...document.querySelectorAll('#stop-options option')];
finder.addEventListener('submit',e=>{e.preventDefault();const query=search.value.trim().toLocaleLowerCase();const status=document.querySelector('#search-feedback');
 if(!query){status.textContent='Enter a shop, place or city first.';search.focus();return;}
 const exact=choices.find(o=>o.value.toLocaleLowerCase()===query);
 const matches=exact?[exact]:choices.filter(o=>(o.value+' '+o.dataset.search).toLocaleLowerCase().includes(query));
 if(!matches.length){status.textContent='No match found. Try a shorter name or choose a suggestion.';return;}
 const match=matches[0],target=document.getElementById(match.dataset.target);
 location.hash=match.dataset.target;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});
 status.textContent=matches.length>1?matches.length+' matches. Showing '+match.value+'. Choose a full suggestion for a specific stop.':'Showing '+match.value+'.';
});
