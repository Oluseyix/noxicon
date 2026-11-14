/** Original vector accelerator study. No stock imagery, logos or tested-device claims. */
export default function Hardware() {
  return <svg className="vc-hardware" viewBox="0 0 1000 700" fill="none" aria-hidden="true">
    <ellipse cx="500" cy="565" rx="340" ry="38" fill="#07110f" opacity=".55"/>
    <g className="vc-device">
      <path d="M122 281 717 547 717 592 122 326Z" fill="#38423f" stroke="#626e68"/>
      <path d="M717 547 925 435 925 480 717 592Z" fill="#16231e" stroke="#596a60"/>
      {Array.from({length:40},(_,i)=><path key={i} d={`M${132+i*14.6} ${292+i*6.53}v26`} stroke="#111e18" strokeWidth="6"/>)}
      {Array.from({length:13},(_,i)=><path key={i} d={`M${730+i*14.6} ${550-i*7.8}v28`} stroke="#0b1510" strokeWidth="7"/>)}
      <g transform="matrix(.85 .38 -.8 .43 330 168)">
        <rect x="-14" y="-15" width="728" height="290" rx="22" fill="#acb6ad" stroke="#d2d7ce" strokeWidth="2"/>
        <rect width="700" height="260" rx="17" fill="#26332d" stroke="#8b9b8c" strokeWidth="3"/>
        <path d="M12 16H688V244H12Z" stroke="#687b6b" strokeWidth="2"/>
        {[130,350,570].map((cx,i)=><g key={cx}>
          <circle cx={cx} cy="130" r="103" fill="#9da99e"/>
          <circle cx={cx} cy="130" r="96" fill="#121e18" stroke="#d0d7c9" strokeWidth="2"/>
          <circle cx={cx} cy="130" r="84" stroke="#718170" strokeWidth="1"/>
          {Array.from({length:11},(_,blade)=><path key={blade} d={`M${cx+12} 118 C${cx+18} 87 ${cx+57} 62 ${cx+73} 78 C${cx+84} 100 ${cx+58} 116 ${cx+28} 139Z`} transform={`rotate(${blade*360/11+i*10} ${cx} 130)`} fill={blade%3===0?'#80917e':'#53674f'} stroke="#a6b39d" strokeWidth=".65"/>)}
          <circle cx={cx} cy="130" r="29" fill="#aeb9a6" stroke="#d5ddcd" strokeWidth="2"/>
          <circle cx={cx} cy="130" r="21" fill="#7a8d73"/>
          <path d={`M${cx-10} 124 ${cx} 141 ${cx+10} 124`} stroke="#e1e6d9" strokeWidth="2.5"/>
        </g>)}
        {[22,678].flatMap(x=>[28,232].map(y=><g key={`${x}-${y}`}><circle cx={x} cy={y} r="5" fill="#bac4b2"/><path d={`M${x-3} ${y}h6`} stroke="#394f3b"/></g>))}
        <path d="M55 263H640V278H55Z" fill="#a2a88b"/>
        {Array.from({length:34},(_,i)=><path key={i} d={`M${68+i*16} 266v10`} stroke="#4c5944" strokeWidth="4"/>)}
      </g>
      <path d="M181 325 312 384 312 401 181 342Z" fill="#bcc7b1"/>
      <text x="212" y="338" transform="rotate(24 212 338)" fill="#23372a" fontFamily="Arial,sans-serif" fontSize="12" letterSpacing="4">NOXICON</text>
      <path d="M752 518 878 451" stroke="#a7c78b" strokeWidth="3"/>
    </g>
    <g stroke="#829680" strokeWidth=".7" opacity=".55"><path d="M793 232H890V170"/><circle cx="793" cy="232" r="3" fill="#bdd1b0"/><path d="M217 441H110V494"/><circle cx="217" cy="441" r="3" fill="#bdd1b0"/></g>
    <g className="vc-hardware-labels" fill="#9aae98" fontFamily="monospace" fontSize="10" letterSpacing="2"><text x="680" y="155">ACCELERATOR STUDY</text><text x="80" y="516">FORM / 001</text></g>
  </svg>;
}
