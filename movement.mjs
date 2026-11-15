// Pure motion in physical metres. The scene converts this to calibrated map units.
export function createMovement({gravity=20,jumpSpeed=6.6,flightSpeed=4.5,doubleTapMs=330}={}) {
  let heightM=0,verticalSpeedMps=0,flying=false,grounded=true,lastSpaceTime=null;
  const snapshot=()=>({state:flying?'flight':grounded?'ground':'air',flying,grounded,heightM,verticalSpeedMps});
  function jump(){if(!flying&&grounded){verticalSpeedMps=jumpSpeed;grounded=false;}return snapshot();}
  function toggleFlight(){flying=!flying;grounded=false;verticalSpeedMps=0;lastSpaceTime=null;return snapshot();}
  function spaceDown(time,{repeat=false}={}){
    if(repeat||!Number.isFinite(time))return snapshot();
    const elapsed=lastSpaceTime===null?Infinity:time-lastSpaceTime;
    if(elapsed>=0&&elapsed<=doubleTapMs)return toggleFlight();
    lastSpaceTime=time;
    if(!flying)jump();
    return snapshot();
  }
  function advance(dt,{up=false,down=false,floorM=0,ceilingM=Infinity}={}){
    if(!Number.isFinite(dt)||dt<=0)return snapshot();
    floorM=Number.isFinite(floorM)?Math.max(0,floorM):0;
    if(flying){
      verticalSpeedMps=((up?1:0)-(down?1:0))*flightSpeed;
      heightM=Math.max(floorM,heightM+verticalSpeedMps*dt);
      if(heightM===floorM&&verticalSpeedMps<0)verticalSpeedMps=0;
      grounded=false;
    }else{
      if(grounded&&heightM>floorM+1e-7){grounded=false;verticalSpeedMps=0;}
      if(!grounded){
        const next=heightM+verticalSpeedMps*dt-.5*gravity*dt*dt;
        verticalSpeedMps-=gravity*dt;
        if(next<=floorM&&verticalSpeedMps<=0){heightM=floorM;verticalSpeedMps=0;grounded=true;}
        else heightM=Math.max(floorM,next);
      }else{heightM=floorM;verticalSpeedMps=0;}
    }
    // ceilingM is the highest permitted foot height, after accounting for body height.
    if(Number.isFinite(ceilingM)&&heightM>Math.max(floorM,ceilingM)){
      heightM=Math.max(floorM,ceilingM);if(verticalSpeedMps>0)verticalSpeedMps=0;
    }
    return snapshot();
  }
  function reset(){heightM=0;verticalSpeedMps=0;flying=false;grounded=true;lastSpaceTime=null;return snapshot();}
  function clearTap(){lastSpaceTime=null;}
  return {snapshot,jump,toggleFlight,spaceDown,advance,reset,clearTap};
}
