// Read-only planner. No filesystem/vault mutation is performed.
function planIdentityMigration({option,oldEnabled=false,newEnabled=false,oldSettings={},newSettings=null}) {
 if(!['A','B'].includes(option))throw Error('Choose identity option A or B');
 if(oldEnabled&&newEnabled)throw Error('Both identities enabled: stop before migration');
 const valid=x=>x&&typeof x==='object'&&!Array.isArray(x);
 if(!valid(oldSettings)||newSettings!==null&&!valid(newSettings))throw Error('Settings must be objects');
 if(option==='B'&&newSettings!==null&&JSON.stringify(oldSettings)!==JSON.stringify(newSettings))throw Error('Destination settings differ; no automatic merge');
 return {targetId:option==='A'?'context-aware-paragraph-notes':'aag-sidenotes',settings:structuredClone(option==='A'?oldSettings:newSettings??oldSettings),sharedDataAction:'PRESERVE_IN_PLACE',requiresDisabledPlugins:true,writesPerformed:false,steps:['Disable both identities','Back up settings, _SideNotes, attachments and Markdown','Install selected identity','Enable only selected identity','Verify settings, notes, anchors, media and rollback']};
}
module.exports={planIdentityMigration};
