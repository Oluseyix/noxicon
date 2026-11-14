'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type HardwareMotion = { progress: number; invalidate?: () => void };

function chassisShape() {
  const shape = new THREE.Shape();
  const x = -3.25, y = -1.3, w = 6.5, h = 2.6, r = .19;
  shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);
  shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);
  shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
  for(const cx of [-1.62,1.62]) { const hole=new THREE.Path();hole.absarc(cx,0,1.09,0,Math.PI*2,true);shape.holes.push(hole); }
  return shape;
}
function bladeShape() {
  const shape=new THREE.Shape();
  shape.moveTo(.21,-.08);shape.bezierCurveTo(.44,-.18,.78,-.15,.99,.11);
  shape.bezierCurveTo(.99,.27,.96,.36,.91,.41);
  shape.bezierCurveTo(.65,.12,.43,.17,.23,.11);shape.closePath();return shape;
}
function Fins(){
  const mesh=useRef<THREE.InstancedMesh>(null);
  useEffect(()=>{const matrix=new THREE.Matrix4();for(let i=0;i<86;i++){matrix.makeTranslation(-3.1+i*.073,0,-.27);mesh.current!.setMatrixAt(i,matrix);}mesh.current!.instanceMatrix.needsUpdate=true;},[]);
  return <instancedMesh ref={mesh} args={[undefined,undefined,86]}><boxGeometry args={[.026,2.37,1.08]}/><meshStandardMaterial color="#888c90" metalness={.96} roughness={.36}/></instancedMesh>;
}
function Fan({x,motion,visible}:{x:number;motion:RefObject<HardwareMotion>;visible:boolean}){
  const fan=useRef<THREE.Group>(null);
  const geometry=useMemo(()=>{
    const blade=new THREE.ExtrudeGeometry(bladeShape(),{depth:.025,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.015,bevelThickness:.012,curveSegments:16});
    const positions=blade.attributes.position;
    for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i);positions.setZ(i,positions.getZ(i)+Math.sin((x-.2)*2.1)*.13+y*.24);}
    blade.computeVertexNormals();return blade;
  },[]);
  useFrame(({clock})=>{if(visible&&fan.current)fan.current.rotation.z=Math.min(clock.elapsedTime,4)*.22+motion.current.progress*2;});
  return <group position={[x,0,.38]}>
    <mesh position={[0,0,-.08]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[1.075,1.075,.12,64]}/><meshStandardMaterial color="#090a0b" roughness={.5} metalness={.65}/></mesh>
    <mesh><torusGeometry args={[1.075,.04,8,64]}/><meshStandardMaterial color="#43464a" metalness={1} roughness={.24}/></mesh>
    <group ref={fan}>{Array.from({length:9},(_,i)=><mesh key={i} geometry={geometry} rotation={[0,0,i*Math.PI*2/9]}><meshStandardMaterial color="#141619" metalness={.8} roughness={.26}/></mesh>)}</group>
    <mesh rotation={[Math.PI/2,0,0]} position={[0,0,.095]}><cylinderGeometry args={[.27,.3,.11,48]}/><meshStandardMaterial color="#a0a3a6" metalness={1} roughness={.24}/></mesh>
    <mesh position={[0,0,.153]}><ringGeometry args={[.13,.14,48]}/><meshStandardMaterial color="#52565b" metalness={1} roughness={.3}/></mesh>
  </group>;
}
function Studio({motion,visible,onReady}:{motion:RefObject<HardwareMotion>;visible:boolean;onReady:()=>void}){
  const group=useRef<THREE.Group>(null);
  const {gl,scene,invalidate}=useThree();
  const housing=useMemo(()=>new THREE.ExtrudeGeometry(chassisShape(),{depth:.12,bevelEnabled:true,bevelSize:.045,bevelThickness:.035,bevelSegments:3,steps:1,curveSegments:40}),[]);
  useEffect(()=>{
    // Three.js owns these mutable renderer objects; this is imperative scene setup.
    // eslint-disable-next-line react-hooks/immutability
    const studio=new RoomEnvironment();const generator=new THREE.PMREMGenerator(gl);const map=generator.fromScene(studio,.04);scene.environment=map.texture;scene.environmentIntensity=.65;
    const controller=motion.current;
    // eslint-disable-next-line react-hooks/immutability -- Shared imperative invalidation bridge, not React render state.
    controller.invalidate=invalidate;invalidate();
    const canvas=gl.domElement;const contextLost=(event:Event)=>{event.preventDefault();canvas.dispatchEvent(new CustomEvent('veyra-context-lost',{bubbles:true}));};canvas.addEventListener('webglcontextlost',contextLost);
    return()=>{scene.environment=null;map.dispose();studio.dispose();generator.dispose();delete controller.invalidate;canvas.removeEventListener('webglcontextlost',contextLost);};
  },[gl,scene,invalidate,motion]);
  useEffect(()=>{if(visible)invalidate();},[visible,invalidate]);
  const ready=useRef(false);
  useFrame(({clock},delta)=>{
    if(!group.current)return;
    if(!ready.current){ready.current=true;onReady();}
    const progress=motion.current.progress;
    const entrance=Math.min(clock.elapsedTime/4,1);
    const targetX=-.64+progress*.6;
    const targetY=-.55+entrance*.14+progress*.65;
    const targetZ=.16-progress*.3;
    group.current.rotation.x=THREE.MathUtils.damp(group.current.rotation.x,targetX,5,Math.min(delta,.1));
    group.current.rotation.y=THREE.MathUtils.damp(group.current.rotation.y,targetY,5,Math.min(delta,.1));
    group.current.rotation.z=THREE.MathUtils.damp(group.current.rotation.z,targetZ,5,Math.min(delta,.1));
    const moving=Math.abs(group.current.rotation.y-targetY)+Math.abs(group.current.rotation.x-targetX)+Math.abs(group.current.rotation.z-targetZ)>.001;
    if(visible&&(entrance<1||moving))invalidate();
  });
  return <>
    <ambientLight intensity={.15}/><directionalLight position={[0,5,6]} intensity={2.2} color="#edf0f5"/><directionalLight position={[-6,-2,3]} intensity={.8}/><pointLight position={[5,3,-2]} intensity={28} color="#cbd2dc"/>
    <group ref={group} rotation={[-.64,-.55,.16]}>
      <Fins/>
      <mesh position={[0,0,-.85]}><boxGeometry args={[6.5,2.6,.1]}/><meshStandardMaterial color="#3d4145" metalness={.95} roughness={.29}/></mesh>
      <mesh geometry={housing} position={[0,0,.28]}><meshStandardMaterial attach="material-0" color="#3d4146" metalness={.9} roughness={.33}/><meshStandardMaterial attach="material-1" color="#a1a4a9" metalness={1} roughness={.23}/></mesh>
      {[-1.22,1.22].flatMap(y=>[.25,-.81].map(z=><mesh key={`${y}-${z}`} position={[0,y,z]}><boxGeometry args={[6.5,.12,.13]}/><meshStandardMaterial color="#686c71" metalness={1} roughness={.25}/></mesh>))}
      <mesh position={[0,0,.47]}><boxGeometry args={[.1,2.12,.04]}/><meshStandardMaterial color="#b6b8bb" metalness={1} roughness={.2}/></mesh>
      <Fan x={-1.62} motion={motion} visible={visible}/><Fan x={1.62} motion={motion} visible={visible}/>
      {[-3.1,-.37,.37,3.1].flatMap(x=>[-1.12,1.12].map(y=><group key={`${x}-${y}`} position={[x,y,.46]}><mesh rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.052,.052,.025,12]}/><meshStandardMaterial color="#303236" metalness={1} roughness={.3}/></mesh><mesh position={[0,0,.015]}><boxGeometry args={[.055,.008,.005]}/><meshBasicMaterial color="#999b9f"/></mesh></group>))}
      <mesh position={[-3.34,0,-.2]}><boxGeometry args={[.12,2.9,1.3]}/><meshStandardMaterial color="#777b80" metalness={1} roughness={.3}/></mesh>
      {Array.from({length:12},(_,i)=><mesh key={i} position={[-3.407,-1.1+i*.19,.02]} rotation={[0,Math.PI/2,0]}><boxGeometry args={[.65,.08,.008]}/><meshStandardMaterial color="#08090a" roughness={.8}/></mesh>)}
      <mesh position={[-.7,-1.43,-.39]}><boxGeometry args={[3.25,.27,.07]}/><meshStandardMaterial color="#77766d" metalness={.85} roughness={.35}/></mesh>
      {Array.from({length:36},(_,i)=><mesh key={i} position={[-2.21+i*.085,-1.44,-.34]}><boxGeometry args={[.047,.2,.008]}/><meshStandardMaterial color="#bbb9a7" metalness={.8} roughness={.3}/></mesh>)}
      {[0,.15,.3].map(y=><mesh key={y} position={[2.75,-.92+y,-.45]} rotation={[0,Math.PI/2,0]}><torusGeometry args={[.31,.055,8,24,Math.PI]}/><meshStandardMaterial color="#a2a1a0" metalness={1} roughness={.25}/></mesh>)}
    </group>
  </>;
}
export default function GPUScene(props:{motion:RefObject<HardwareMotion>;visible:boolean;onReady:()=>void}){
  return <Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:[0,0,11.2],fov:36}} gl={{antialias:true,alpha:true,powerPreference:'low-power'}} fallback={null} style={{pointerEvents:'none'}}><Studio {...props}/></Canvas>;
}
