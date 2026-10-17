import React,{useContext,useEffect,useState} from 'react';
import {ActivityContext} from './field/ui';
import {Roster} from './Roster.jsx';
import {RosterWorkflow} from './RosterWorkflow.jsx';
import {staffPermission} from '../../shared/staff-access.js';
export function RosterArea({user,section='mine',requestSignal=0}) {
  const active=useContext(ActivityContext);
  const manage=staffPermission(user,'roster.repair.manage')||staffPermission(user,'roster.repair.configure');
  const read=staffPermission(user,'roster.read');
  if(!read&&manage)section='manage';
  const [visited,setVisited]=useState([section]);
  useEffect(()=>setVisited(current=>current.includes(section)?current:[...current,section]),[section]);
  return <section className="roster-area">{visited.includes('manage')&&manage&&<ActivityContext.Provider value={active&&section==='manage'}><div hidden={section!=='manage'} className="roster-section"><RosterWorkflow user={user}/></div></ActivityContext.Provider>}{visited.includes('mine')&&read&&<ActivityContext.Provider value={active&&section!=='manage'}><div hidden={section==='manage'} className="roster-section"><Roster user={user} requestSignal={requestSignal}/></div></ActivityContext.Provider>}</section>;
}
