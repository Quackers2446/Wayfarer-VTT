// Rules commit immediately; the viewer reveals each HP change with its dice result.
export function createHealthPresentation(){
  let scope,cursor=0;const pending=new Map();
  return {
    sync(nextScope,events=[]){
      const latest=events.at(-1)?.id ?? 0;
      if(scope!==nextScope || latest<cursor){scope=nextScope;cursor=latest;pending.clear();return;}
      for(const event of events) if(event.id>cursor && event.healthChanges?.length) pending.set(event.id,event.healthChanges);
      cursor=latest;
    },
    reveal(event){for(const entry of event.partyEvents ?? [event]) pending.delete(entry.id);},
    actor(actor){
      if(!actor) return actor;
      for(const changes of pending.values()) {const change=changes.find(change=>change.actor===actor.id);if(change) return {...actor,...change.before};}
      return actor;
    },
  };
}
