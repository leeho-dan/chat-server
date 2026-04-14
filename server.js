<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>디자인 상담</title>

<style>
:root{
  --bg:#f4f8fc;
  --bg-soft:#f8fbff;
  --card:#ffffff;
  --card-soft:rgba(255,255,255,0.92);
  --line:#e4ebf3;
  --line-strong:#d8e2ec;
  --text:#17212b;
  --text-soft:#24313f;
  --sub:#758394;
  --sub-soft:#8e9baa;
  --primary:#2491ff;
  --primary-soft:#6fc3ff;
  --success:#2f9e44;
  --danger:#ff5b5b;
  --danger-soft:#fff3f3;
  --warning:#f59e0b;
  --warning-soft:#fff7ea;
  --shadow:0 18px 50px rgba(18,36,61,0.10);
  --radius-xl:30px;
  --radius-lg:22px;
  --radius-md:18px;
  --radius-sm:14px;
}

*{ box-sizing:border-box; }
html, body{
  margin:0;
  width:100%;
  height:100%;
  font-family:-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(36,145,255,0.08), transparent 24%),
    linear-gradient(180deg, #f9fbff 0%, #edf4fa 100%);
  color:var(--text);
}
body{
  overflow:hidden;
  -webkit-text-size-adjust:100%;
}
button, input, textarea, label{ font:inherit; }
button{ cursor:pointer; border:none; }
button:disabled{ cursor:not-allowed; opacity:0.5; }
input, textarea{ border:none; outline:none; }

.srOnly{
  position:absolute;
  width:1px;
  height:1px;
  padding:0;
  margin:-1px;
  overflow:hidden;
  clip:rect(0,0,0,0);
  white-space:nowrap;
  border:0;
}

.btnIcon{
  display:none;
  align-items:center;
  justify-content:center;
  width:1em;
  height:1em;
  line-height:1;
  flex-shrink:0;
  transform:translateY(-0.02em);
}

#app{
  width:100%;
  height:100%;
  padding:14px;
  display:flex;
  align-items:center;
  justify-content:center;
}

#chatCard{
  width:min(940px, 100%);
  height:min(94dvh, 900px);
  background:var(--card-soft);
  backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,0.84);
  border-radius:var(--radius-xl);
  box-shadow:var(--shadow);
  overflow:hidden;
  display:flex;
  flex-direction:column;
}

#header{
  height:76px;
  flex-shrink:0;
  border-bottom:1px solid var(--line);
  display:flex;
  align-items:center;
  justify-content:center;
  position:relative;
  background:rgba(255,255,255,0.94);
}

#title{
  font-size:26px;
  font-weight:800;
  letter-spacing:-0.03em;
}

#roleBadge{
  position:absolute;
  left:16px;
  top:50%;
  transform:translateY(-50%);
  padding:8px 12px;
  border-radius:999px;
  background:#f7faff;
  border:1px solid var(--line);
  color:var(--sub);
  font-size:12px;
  font-weight:700;
}

#headerActions{
  position:absolute;
  right:14px;
  top:50%;
  transform:translateY(-50%);
  display:flex;
  gap:8px;
}

.iconBtn{
  width:42px;
  height:42px;
  border-radius:50%;
  background:#edf4fa;
  color:#557086;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:18px;
  line-height:1;
  box-shadow:0 1px 0 rgba(255,255,255,0.6) inset;
}

#chatBox{
  flex:1;
  min-height:0;
  overflow-y:auto;
  padding:18px 16px 10px;
  background:var(--bg-soft);
}

#chatInner{
  display:flex;
  flex-direction:column;
  gap:14px;
  min-height:100%;
}

.messageRow{
  display:flex;
  flex-direction:column;
  gap:5px;
}
.messageRow.me{ align-items:flex-end; }
.messageRow.other{ align-items:flex-start; }

.bubble{
  max-width:min(74%, 560px);
  padding:12px 16px;
  border-radius:22px;
  font-size:15px;
  line-height:1.52;
  letter-spacing:-0.02em;
  word-break:break-word;
}
.messageRow.me .bubble{
  background:linear-gradient(135deg, var(--primary-soft), var(--primary));
  color:white;
  border-bottom-right-radius:8px;
  box-shadow:0 8px 20px rgba(36,145,255,0.16);
}
.messageRow.other .bubble{
  background:#ffffff;
  color:var(--text);
  border:1px solid var(--line);
  border-bottom-left-radius:8px;
}
.meta{
  font-size:10px;
  color:#95a3b1;
  padding:0 8px;
}

.imageBubble{
  max-width:min(72%, 520px);
  background:#ffffff;
  border:1px solid var(--line);
  border-radius:22px;
  padding:8px;
  cursor:pointer;
  box-shadow:0 8px 18px rgba(18,36,61,0.04);
  transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.imageBubble:hover{
  transform:translateY(-1px);
  box-shadow:0 14px 26px rgba(18,36,61,0.08);
  border-color:#d5e4f3;
}
.messageRow.me .imageBubble{ border-bottom-right-radius:8px; }
.messageRow.other .imageBubble{ border-bottom-left-radius:8px; }

.chatImg{
  display:block;
  width:100%;
  max-width:240px;
  border-radius:14px;
}

#inputArea{
  flex-shrink:0;
  border-top:1px solid var(--line);
  background:rgba(255,255,255,0.96);
  padding:10px 14px 12px;
  display:flex;
  flex-direction:column;
  gap:8px;
}

#contactToggleBar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:10px 12px;
  border:1px solid var(--line);
  border-radius:16px;
  background:#fbfdff;
}

#contactToggleText{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:2px;
}

#contactToggleTitle{
  font-size:13px;
  font-weight:800;
  color:var(--text-soft);
}

#contactToggleDesc{
  font-size:11px;
  color:var(--sub);
  line-height:1.4;
}

#toggleContactPanelBtn{
  height:34px;
  border-radius:999px;
  padding:0 12px;
  background:#edf4fa;
  color:#425466;
  font-size:12px;
  font-weight:800;
  flex-shrink:0;
}

#utilityRow{ display:none; }
#utilityRow.open{ display:block; }

#phonePanel{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px;
  border:1px solid #dce7f1;
  border-radius:18px;
  background:linear-gradient(180deg, #f8fbff, #f3f8fd);
}
#phonePanelHeader{
  display:flex;
  align-items:flex-start;
  gap:10px;
}
#phonePanelIcon{
  width:34px;
  height:34px;
  border-radius:12px;
  background:#e8f2ff;
  color:#3d88ea;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:16px;
  line-height:1;
  flex-shrink:0;
}
#phonePanelText{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:3px;
}
#phonePanelTitle{
  font-size:13px;
  font-weight:800;
  color:var(--text-soft);
  letter-spacing:-0.01em;
}
#phonePanelDesc{
  font-size:12px;
  color:#708092;
  line-height:1.45;
}
#phoneRow{
  display:flex;
  gap:8px;
}
#phoneStatus{
  display:none;
  font-size:12px;
  color:#5f7286;
  padding:0 2px;
}
#phoneStatus.show{ display:block; }

#phoneInput{
  flex:1;
  height:42px;
  border:1px solid var(--line-strong);
  background:#f8fbff;
  border-radius:16px;
  padding:0 14px;
  font-size:16px;
}
#savePhoneBtn{
  height:42px;
  border-radius:16px;
  min-width:64px;
  padding:0 16px;
  background:#607082;
  color:white;
  font-weight:800;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
}

#messageRow{
  display:flex;
  align-items:center;
  gap:8px;
}
#msgInput{
  flex:1;
  height:48px;
  border:1px solid var(--line-strong);
  background:#f8fbff;
  border-radius:18px;
  padding:0 16px;
  font-size:16px;
}
#msgInput:focus,
#phoneInput:focus,
#viewerMsgInput:focus,
#noteEditorTextarea:focus{
  background:#ffffff;
  border-color:rgba(36,145,255,0.45);
  box-shadow:0 0 0 4px rgba(36,145,255,0.08);
}
#sendBtn{
  width:48px;
  height:48px;
  border-radius:50%;
  background:linear-gradient(135deg, #79c7ff, var(--primary));
  color:white;
  font-size:20px;
  font-weight:800;
  box-shadow:0 8px 20px rgba(36,145,255,0.16);
}
#fileInput{ display:none; }
#fileLabel{
  width:48px;
  height:48px;
  border-radius:50%;
  background:#f2f6fa;
  color:#7b8d9f;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:22px;
  cursor:pointer;
  border:1px solid #e5edf4;
}

#viewerOverlay{
  position:fixed;
  inset:0;
  z-index:100;
  display:none;
  flex-direction:column;
  background:rgba(245,248,252,0.98);
}
#viewerOverlay.open{ display:flex; }

#viewerTopbar{
  height:76px;
  flex-shrink:0;
  border-bottom:1px solid var(--line);
  background:rgba(255,255,255,0.96);
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 14px;
  gap:12px;
}

#viewerTopLeft{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:4px;
}
#viewerTitle{
  font-size:18px;
  font-weight:800;
}
#viewerSubtitle{
  font-size:12px;
  color:var(--sub);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

#viewerStats{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}
.statBadge{
  height:30px;
  padding:0 10px;
  border-radius:999px;
  background:#eef4fa;
  color:#587085;
  font-size:12px;
  display:flex;
  align-items:center;
  font-weight:700;
}
.statBadge.state-connected{
  background:#ecf9ef;
  color:#2f7b42;
}
.statBadge.state-pending{
  background:var(--warning-soft);
  color:#9a6500;
}
.statBadge.state-saved{
  background:#ecf9ef;
  color:#2f7b42;
}
.statBadge.state-offline{
  background:#fff3f3;
  color:#c74242;
}

#viewerActions{
  display:flex;
  gap:8px;
  flex-shrink:0;
}
.viewerBtn{
  height:38px;
  border-radius:12px;
  padding:0 14px;
  background:#edf4fa;
  color:#425466;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  font-weight:700;
  line-height:1;
}

#viewerMain{
  flex:1;
  min-height:0;
  display:grid;
  grid-template-columns:7fr 3fr;
}
#viewerLeft{
  min-width:0;
  display:flex;
  flex-direction:column;
  border-right:1px solid var(--line);
  background:#f8fbff;
}
#canvasWrap{
  flex:1;
  min-height:0;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:14px;
  background:#f7fbff;
}
#imageStage{
  position:relative;
  width:min(100%, 1200px);
  height:min(100%, 760px);
  min-height:420px;
  border-radius:22px;
  background:linear-gradient(180deg, rgba(255,255,255,0.92), rgba(247,251,255,0.96));
  border:1px solid #dfe9f3;
  box-shadow:0 18px 38px rgba(18,36,61,0.08);
  overflow:hidden;
}
#viewerImage{
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%, -50%);
  max-width:84%;
  max-height:84%;
  border-radius:18px;
  box-shadow:0 14px 32px rgba(18,36,61,0.12);
  pointer-events:none;
  user-select:none;
  -webkit-user-drag:none;
  z-index:1;
}
#drawCanvas{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  border-radius:22px;
  touch-action:none;
  pointer-events:auto;
  z-index:2;
}
#textLayer{
  position:absolute;
  inset:0;
  z-index:3;
  pointer-events:none;
}

.noteMarker{
  position:absolute;
  min-width:56px;
  height:42px;
  padding:0 12px;
  border-radius:14px;
  display:flex;
  align-items:center;
  gap:6px;
  background:rgba(255,255,255,0.70);
  backdrop-filter:blur(8px);
  color:#24313f;
  border:1px solid rgba(36,145,255,0.16);
  box-shadow:0 10px 18px rgba(18,36,61,0.08);
  transform:translate(-50%, -50%);
  pointer-events:auto;
  user-select:none;
  touch-action:none;
}
.noteMarker[data-author="admin"]{
  border-color:rgba(138,92,255,0.18);
}
.noteMarker.selected{
  border-color:rgba(255,139,61,0.55);
  box-shadow:0 0 0 3px rgba(255,139,61,0.14), 0 10px 18px rgba(18,36,61,0.10);
}
.noteMarkerText{
  max-width:132px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:12px;
  font-weight:800;
}
.noteResize{
  position:absolute;
  right:-5px;
  bottom:-5px;
  width:14px;
  height:14px;
  border-radius:5px;
  background:#2491ff;
  box-shadow:0 4px 10px rgba(36,145,255,0.18);
  cursor:nwse-resize;
}
.noteMarker[data-author="admin"] .noteResize{
  background:#8a5cff;
}

#toolbar{
  border-top:1px solid var(--line);
  background:#ffffff;
  padding:14px 12px 16px;
  display:flex;
  flex-direction:column;
  gap:16px;
  flex-shrink:0;
}
#mobileToolHint{
  display:none;
  padding:8px 10px;
  border-radius:12px;
  background:#f6fbff;
  border:1px solid #dceaf8;
  color:#5b7085;
  font-size:11px;
  font-weight:700;
  line-height:1.4;
}
.toolSection{
  display:flex;
  flex-direction:column;
  gap:10px;
}
.toolSectionLabel{
  font-size:11px;
  font-weight:800;
  color:var(--sub-soft);
  padding:0 2px;
  letter-spacing:0.02em;
  text-transform:uppercase;
}
.toolRow{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.toolGroup{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  padding-bottom:8px;
}
.toolGroup.fill{
  flex:1;
}
.toolBtn{
  height:38px;
  border-radius:12px;
  padding:0 12px;
  background:#edf4fa;
  color:#425466;
  font-weight:700;
  white-space:nowrap;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  line-height:1;
}
.toolBtn.active{
  background:linear-gradient(135deg, #79c7ff, var(--primary));
  color:white;
}
.toolBtn.danger{
  background:var(--danger-soft);
  color:#c74242;
}
#thicknessWrap{
  display:flex;
  align-items:center;
  gap:8px;
  color:var(--sub);
  font-size:12px;
  font-weight:700;
  flex-shrink:0;
}
#thicknessRange{ width:120px; }

#colorRow,
#noteColorRow{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  align-items:center;
  min-height:30px;
}
#colorRow{
  display:none;
  padding:10px 10px 12px;
  border:1px solid #dce7f1;
  border-radius:14px;
  background:#f8fbff;
  box-shadow:0 10px 24px rgba(18,36,61,0.08);
}
#colorRow.open{ display:flex; }

#noteColorHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}
#noteColorTitle{
  font-size:12px;
  font-weight:800;
  color:var(--sub);
}
#toggleNoteColorsBtn{
  height:30px;
  border-radius:999px;
  padding:0 12px;
  background:#edf4fa;
  color:#425466;
  font-size:12px;
  font-weight:700;
}
.colorSwatch{
  width:26px;
  height:26px;
  border-radius:50%;
  box-shadow:0 0 0 1px rgba(0,0,0,0.10);
  flex:0 0 auto;
}
.colorSwatch.active{
  box-shadow:0 0 0 3px rgba(36,145,255,0.20);
}
#customColorBtn{
  position:relative;
  overflow:hidden;
  background:
    linear-gradient(135deg, rgba(255,255,255,0.95), rgba(228,236,245,0.95)),
    conic-gradient(from 180deg, #ff3b30, #f59e0b, #22c55e, #2491ff, #a855f7, #ff3b30);
}
#customColorBtn::before{
  content:"";
  position:absolute;
  inset:4px;
  border-radius:50%;
  background:var(--custom-color-preview, conic-gradient(from 180deg, #ff3b30, #f59e0b, #22c55e, #2491ff, #a855f7, #ff3b30));
}
#customColorBtn::after{
  content:"+";
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  color:#ffffff;
  font-size:14px;
  font-weight:900;
  text-shadow:0 1px 2px rgba(0,0,0,0.35);
}
#customColorInput{
  position:absolute;
  pointer-events:none;
  opacity:0;
}
.noteColorSwatch{
  width:22px;
  height:22px;
  border-radius:50%;
  box-shadow:0 0 0 1px rgba(0,0,0,0.10);
}
.noteColorSwatch.active{
  box-shadow:0 0 0 3px rgba(36,145,255,0.18);
}
#noteColorRow{
  padding-bottom:8px;
}

#viewerRight{
  min-width:0;
  display:flex;
  flex-direction:column;
  background:#ffffff;
}
#viewerChatHeader{
  height:52px;
  flex-shrink:0;
  border-bottom:1px solid var(--line);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:16px;
  font-weight:800;
}
#viewerChatBox{
  flex:1;
  min-height:0;
  overflow-y:auto;
  padding:12px;
  background:#fbfdff;
}
#viewerChatInner{
  display:flex;
  flex-direction:column;
  gap:10px;
}
#viewerInputBar{
  flex-shrink:0;
  border-top:1px solid var(--line);
  padding:10px 12px 12px;
  background:#ffffff;
  display:flex;
  gap:8px;
}
#viewerMsgInput{
  flex:1;
  height:44px;
  border:1px solid var(--line-strong);
  background:#f8fbff;
  border-radius:16px;
  padding:0 14px;
  font-size:16px;
}
#viewerSendBtn{
  width:44px;
  height:44px;
  border-radius:50%;
  background:linear-gradient(135deg, #79c7ff, var(--primary));
  color:white;
  font-size:18px;
  font-weight:800;
}

#noteEditorOverlay{
  position:fixed;
  inset:0;
  z-index:220;
  display:none;
  flex-direction:column;
  background:rgba(245,248,252,0.98);
}
#noteEditorOverlay.open{ display:flex; }

#noteEditorHeader{
  height:68px;
  flex-shrink:0;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:0 14px;
  border-bottom:1px solid var(--line);
  background:#ffffff;
}
#noteEditorTitleWrap{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:4px;
}
#noteEditorTitle{
  font-size:17px;
  font-weight:800;
}
#noteEditorMeta{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}
#noteEditorTimestamp{
  font-size:12px;
  color:var(--sub);
}
#noteEditorSaveBadge{
  height:24px;
  padding:0 8px;
  border-radius:999px;
  font-size:11px;
  font-weight:800;
  display:inline-flex;
  align-items:center;
  background:#eef4fa;
  color:#587085;
}
#noteEditorSaveBadge.pending{
  background:var(--warning-soft);
  color:#9a6500;
}
#noteEditorSaveBadge.saved{
  background:#ecf9ef;
  color:#2f7b42;
}
#noteEditorSaveBadge.offline{
  background:#fff3f3;
  color:#c74242;
}
#noteEditorDoneBtn{
  height:38px;
  border-radius:12px;
  padding:0 14px;
  background:linear-gradient(135deg, #79c7ff, var(--primary));
  color:#fff;
  font-weight:800;
}
#noteEditorBody{
  flex:1;
  min-height:0;
  padding:14px;
  background:#f7fbff;
}
#noteEditorTextarea{
  width:100%;
  height:100%;
  border:1px solid var(--line-strong);
  border-radius:20px;
  background:#fffef8;
  resize:none;
  padding:16px;
  font-size:16px;
  line-height:1.55;
  color:var(--text);
}

@media (max-width: 900px){
  #app{ padding:0; }
  #chatCard{
    width:100%;
    height:100dvh;
    border-radius:0;
  }
  #header{
    height:64px;
    min-height:64px;
  }
  #title{ font-size:22px; }
  #roleBadge{
    left:10px;
    padding:6px 10px;
    font-size:11px;
  }
  #chatBox{ padding:14px 12px 8px; }
  .bubble{
    max-width:84%;
    font-size:14px;
    padding:11px 14px;
  }
  .chatImg{ max-width:200px; }

  #inputArea{
    padding:8px 10px 10px;
    gap:6px;
  }
  #msgInput, #sendBtn, #fileLabel{ height:44px; }
  #sendBtn, #fileLabel{ width:44px; }
  #msgInput, #viewerMsgInput, #phoneInput{ font-size:16px; }

  #contactToggleBar{ padding:9px 10px; }
  #contactToggleDesc{ font-size:10px; }

  #phonePanel{ padding:11px; gap:9px; }
  #phonePanelHeader{ gap:8px; }
  #phonePanelIcon{
    width:32px; height:32px; border-radius:10px;
  }
  #phoneRow{ flex-direction:column; }
  #savePhoneBtn{
    width:100%;
    min-width:0;
  }

  #viewerTopbar{
    height:auto;
    min-height:0;
    display:grid;
    grid-template-columns:auto minmax(0, 1fr) auto;
    grid-template-areas:"stats title actions";
    align-items:center;
    gap:6px 10px;
    padding:8px 10px;
  }
  #viewerTopLeft{
    grid-area:title;
    width:100%;
    gap:0;
    justify-self:start;
  }
  #viewerTitle{
    font-size:15px;
    line-height:1.2;
  }
  #viewerSubtitle{ display:none; }

  #viewerStats{
    grid-area:stats;
    width:auto;
    gap:6px;
    flex-wrap:nowrap;
    overflow-x:auto;
    scrollbar-width:none;
  }
  #viewerStats::-webkit-scrollbar{ display:none; }

  .statBadge{
    height:24px;
    padding:0 7px;
    font-size:0;
    gap:0;
    white-space:nowrap;
  }
  .statBadge::before{
    content:attr(data-icon);
    font-size:11px;
    line-height:1;
  }
  .statBadge::after{
    content:attr(data-count);
    margin-left:4px;
    font-size:10px;
    line-height:1;
    font-weight:800;
  }

  #viewerActions{
    grid-area:actions;
    width:auto;
    justify-content:flex-end;
    align-self:center;
  }

  #viewerMain{
    display:flex;
    flex-direction:column;
    min-height:0;
  }
  #viewerLeft{ display:contents; }
  #canvasWrap{
    flex:5 1 0;
    padding:8px;
    min-height:0;
  }
  #imageStage{
    min-height:0;
    height:100%;
    border-radius:18px;
  }

  #toolbar{
    flex:2 1 0;
    min-height:0;
    padding:8px 10px 10px;
    gap:8px;
    overflow:hidden;
  }
  #mobileToolHint{ display:block; }

  .toolGroup{
    flex-wrap:nowrap;
    overflow-x:auto;
    overflow-y:hidden;
    padding-bottom:10px;
    scrollbar-width:none;
    -webkit-overflow-scrolling:touch;
  }
  .toolGroup::-webkit-scrollbar{ display:none; }

  .toolBtn{
    min-width:44px;
    height:40px;
    padding:0 10px;
    border-radius:12px;
  }
  .toolBtn .btnText,
  .viewerBtn .btnText,
  #savePhoneBtn .btnText{ display:none; }
  .toolBtn .btnIcon,
  .viewerBtn .btnIcon,
  #savePhoneBtn .btnIcon{ display:inline-flex; }

  #noteColorHeader{
    justify-content:flex-start;
    gap:8px;
  }
  #noteColorTitle{ display:none; }

  #toggleNoteColorsBtn{
    width:30px;
    min-width:30px;
    height:30px;
    padding:0;
    border-radius:10px;
    font-size:0;
  }
  #toggleNoteColorsBtn::before{
    content:"◐";
    font-size:14px;
    line-height:1;
  }

  #noteColorRow{
    display:none;
    gap:6px;
    padding-bottom:10px;
  }
  #noteColorRow.open{ display:flex; }
  #colorRow{ padding:10px 8px 12px; }

  #viewerRight{
    flex:3 1 0;
    min-height:0;
    border-top:1px solid var(--line);
  }
  #viewerChatHeader{ display:none; }
  #viewerChatBox{ padding:10px 10px 6px; }
  #viewerChatInner{ gap:8px; }
  #viewerInputBar{ padding:8px 10px 10px; }
  #viewerMsgInput{
    height:42px;
    font-size:16px;
  }
  #viewerSendBtn{
    width:42px;
    height:42px;
  }

  .noteMarker{
    min-width:50px;
    height:38px;
    padding:0 10px;
  }
  .noteMarkerText{
    max-width:96px;
    font-size:11px;
  }

  #noteEditorHeader{
    height:auto;
    min-height:64px;
    align-items:flex-start;
    padding:10px 12px;
  }
}
</style>
</head>
<body>

<div id="app">
  <section id="chatCard">
    <div id="header">
      <div id="roleBadge">고객 채팅</div>
      <div id="title">디자인 상담</div>
      <div id="headerActions">
        <button id="openViewerBtn" class="iconBtn" type="button" aria-label="선택한 이미지를 뷰어로 열기">⛶</button>
      </div>
    </div>

    <div id="chatBox">
      <div id="chatInner"></div>
    </div>

    <div id="inputArea">
      <div id="contactToggleBar">
        <div id="contactToggleText">
          <div id="contactToggleTitle">연락처 남기기</div>
          <div id="contactToggleDesc">이미지 검토를 마친 뒤 필요할 때만 연락처를 남길 수 있어요.</div>
        </div>
        <button id="toggleContactPanelBtn" type="button" aria-expanded="false">열기</button>
      </div>

      <div id="utilityRow">
        <div id="phonePanel">
          <div id="phonePanelHeader">
            <div id="phonePanelIcon" aria-hidden="true">☎</div>
            <div id="phonePanelText">
              <div id="phonePanelTitle">연락받으실 전화번호</div>
              <div id="phonePanelDesc">상담 진행상 필요할 때만 연락드려요.</div>
            </div>
          </div>

          <div id="phoneRow">
            <input id="phoneInput" type="tel" placeholder="연락받으실 전화번호를 입력해 주세요." />
            <button id="savePhoneBtn" type="button" aria-label="전화번호 등록">
              <span class="btnIcon">✓</span>
              <span class="btnText">등록</span>
            </button>
          </div>
        </div>
      </div>

      <div id="phoneStatus" aria-live="polite"></div>

      <div id="messageRow">
        <input id="msgInput" type="text" placeholder="메시지 입력..." autocomplete="off" />
        <button id="sendBtn" type="button" aria-label="메시지 전송">➤</button>
        <label id="fileLabel" for="fileInput" aria-label="이미지 첨부">📎</label>
        <input id="fileInput" type="file" accept="image/*"
