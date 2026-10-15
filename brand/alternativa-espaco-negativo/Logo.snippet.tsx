// Substitui a função Logo() em src/App.tsx. Logo Stormusic (listras e play vazados: o fundo aparece por dentro).
// O vermelho da logo (#E50C16) é o do arquivo original: não recolorir. O resto da interface mantém a paleta atual.
function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="168.6 311.0 686.4 862.5" className="h-8 w-auto shrink-0" role="img" aria-label="Stormusic">
        <path fill="#E50C16" fill-rule="evenodd" d="M512 311 L168.6 509.2 L168.6 747 L514.5 955 L514.5 1003.5 L168.6 796.2 L168.6 829.2 L514.5 1037.5 L514.5 1085.2 L168.6 879 L168.6 974 L512 1173.5 L855 975 L855 748.8 L505.3 537.5 L505.3 489 L855 699.2 L855 665.2 L505.3 454.8 L505.3 406.2 L855 615 L855 509.5 Z M450 648.1 Q450 632.2 463.6 640.3 L619.5 733.6 Q632.6 741.4 619.5 749.1 L463.5 840.2 Q450 848.1 450 832.4 Z"/>
      </svg>
      <span className="font-semibold tracking-tight text-[19px] leading-none">Storm<span style={{ color: '#ff4e6b' }}>usic</span></span>
    </div>
  )
}
