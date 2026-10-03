#!/usr/bin/env python3
import argparse, json, math, os, subprocess, textwrap
from pathlib import Path
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W,H=1080,1920
SCREEN_X,SCREEN_Y,SCREEN_W,SCREEN_H=206,382,668,1448
PHONE_X,PHONE_Y,PHONE_W,PHONE_H=180,350,720,1512
FPS=30
FONT_REG='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def sh(cmd):
    print('+', ' '.join(map(str,cmd)), flush=True)
    subprocess.run(cmd, check=True)

def probe(path):
    r=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)], text=True).strip()
    return float(r)

def sec(iso0,iso):
    def p(x): return datetime.fromisoformat(x.replace('Z','+00:00'))
    return (p(iso)-p(iso0)).total_seconds()

def font(path,size):
    return ImageFont.truetype(path,size)

def rounded_gradient_bg(path):
    im=Image.new('RGB',(W,H),(7,10,16)); px=im.load()
    for y in range(H):
        t=y/(H-1)
        r=int(8*(1-t)+3*t); g=int(14*(1-t)+8*t); b=int(24*(1-t)+14*t)
        for x in range(W): px[x,y]=(r,g,b)
    glow=Image.new('RGBA',(W,H),(0,0,0,0)); gd=ImageDraw.Draw(glow)
    gd.ellipse((-220,170,520,910), fill=(255,92,36,35))
    gd.ellipse((650,500,1280,1280), fill=(46,99,255,28))
    glow=glow.filter(ImageFilter.GaussianBlur(120))
    im=Image.alpha_composite(im.convert('RGBA'),glow)
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((48,62,1032,336), radius=34, fill=(10,16,27,242), outline=(255,255,255,24), width=2)
    d.text((72,24),'VIIVERSION  /  MAX TOUR',font=font(FONT_BOLD,22),fill=(228,234,242,190))
    d.text((1008,24),'PRODUCT DEMO',font=font(FONT_REG,17),fill=(171,184,202,150),anchor='ra')
    im.save(path)

def phone_frame(path):
    im=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(im)
    shadow=Image.new('RGBA',(W,H),(0,0,0,0)); sd=ImageDraw.Draw(shadow)
    sd.rounded_rectangle((PHONE_X+4,PHONE_Y+14,PHONE_X+PHONE_W+4,PHONE_Y+PHONE_H+18),radius=58,fill=(0,0,0,145))
    shadow=shadow.filter(ImageFilter.GaussianBlur(26)); im=Image.alpha_composite(im,shadow); d=ImageDraw.Draw(im)
    d.rounded_rectangle((PHONE_X,PHONE_Y,PHONE_X+PHONE_W,PHONE_Y+PHONE_H),radius=58,fill=(16,18,22,255),outline=(174,184,200,145),width=3)
    d.rounded_rectangle((PHONE_X+11,PHONE_Y+11,PHONE_X+PHONE_W-11,PHONE_Y+PHONE_H-11),radius=49,outline=(255,255,255,42),width=2)
    mask=Image.new('L',(W,H),0); md=ImageDraw.Draw(mask)
    md.rounded_rectangle((SCREEN_X,SCREEN_Y,SCREEN_X+SCREEN_W,SCREEN_Y+SCREEN_H),radius=39,fill=255)
    arr=im.copy(); arr.putalpha(ImageChops_subtract(im.getchannel('A'),mask))
    im=arr; d=ImageDraw.Draw(im)
    d.rounded_rectangle((W//2-58,PHONE_Y+18,W//2+58,PHONE_Y+39),radius=11,fill=(3,4,6,245))
    d.rounded_rectangle((PHONE_X-5,PHONE_Y+245,PHONE_X+4,PHONE_Y+350),radius=4,fill=(101,108,119,220))
    d.rounded_rectangle((PHONE_X+PHONE_W-4,PHONE_Y+300,PHONE_X+PHONE_W+5,PHONE_Y+425),radius=4,fill=(101,108,119,220))
    im.save(path)

def ImageChops_subtract(a,b):
    from PIL import ImageChops
    return ImageChops.subtract(a,b)

def wrap_two(text, max_chars=34):
    words=text.split(); lines=[]; cur=''
    for w in words:
        cand=(cur+' '+w).strip()
        if len(cand)<=max_chars or not cur:
            cur=cand
        else:
            lines.append(cur); cur=w
    if cur: lines.append(cur)
    if len(lines)<=2: return r'\N'.join(lines)
    total=sum(len(w)+1 for w in words); target=total/2; s=0; split=1
    for i,w in enumerate(words[:-1],1):
        s += len(w)+1
        if s>=target: split=i; break
    return ' '.join(words[:split])+r'\N'+' '.join(words[split:])

def ass_time(s):
    cs=max(0,round(s*100)); h=cs//360000; cs%=360000; m=cs//6000; cs%=6000; sec_=cs//100; c=cs%100
    return f'{h}:{m:02d}:{sec_:02d}.{c:02d}'

def write_ass(path, sections, starts, durations, total):
    header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,92,92,138,1
Style: Benefit,DejaVu Sans,21,&H003E94FF,&H003E94FF,&H00000000,&H00000000,-1,0,0,0,100,100,1.1,0,1,0,0,8,92,92,84,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    events=[]
    for secobj,start,dur in zip(sections,starts,durations):
        events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(start+dur)},Benefit,,0,0,0,,{secobj['benefit']}")
        chunks=secobj['subs']; weights=[max(1,len(c.replace('\\N','').replace(' ',''))) for c in chunks]; tw=sum(weights); cur=start
        for i,(ch,w) in enumerate(zip(chunks,weights)):
            end=start+dur if i==len(chunks)-1 else cur+dur*w/tw
            events.append(f"Dialogue: 0,{ass_time(cur)},{ass_time(end)},Caption,,0,0,0,,{wrap_two(ch)}")
            cur=end
    Path(path).write_text(header+'\n'.join(events)+'\n',encoding='utf-8')

def make_cta_card(path, screenshot):
    bg=Image.open(Path(path).parent/'bg.png').convert('RGBA')
    d=ImageDraw.Draw(bg)
    d.text((72,420),'TURN YOUR TOURS INTO',font=font(FONT_BOLD,49),fill='white')
    d.text((72,482),'A BETTER CUSTOMER JOURNEY',font=font(FONT_BOLD,49),fill='white')
    d.text((72,572),'Build your version with VIIVERSION.',font=font(FONT_REG,27),fill=(205,214,226,230))
    d.rounded_rectangle((72,635,420,705),radius=35,fill=(255,92,36,255))
    d.text((246,670),'MESSAGE US  →',font=font(FONT_BOLD,24),fill='white',anchor='mm')
    shot=Image.open(screenshot).convert('RGB')
    sw,sh=390,846; sx,sy=345,820
    shot=shot.resize((sw,sh),Image.Resampling.LANCZOS)
    d.rounded_rectangle((sx-18,sy-28,sx+sw+18,sy+sh+28),radius=42,fill=(14,16,20,255),outline=(170,180,194,130),width=3)
    bg.paste(shot,(sx,sy))
    d.rounded_rectangle((sx+sw//2-45,sy-17,sx+sw//2+45,sy+2),radius=10,fill=(3,4,6,255))
    d.text((72,1780),'VIIVERSION.COM',font=font(FONT_BOLD,22),fill=(198,208,222,180))
    bg.save(path)

def render_beat(capture,bg,frame,out,src_start,src_available,dur,z0,z1,cx0,cy0,cx1,cy1):
    move=max(1,int(dur*FPS*0.75))
    zexpr=f"{z0:.5f}+({z1-z0:.5f})*min(1,on/{move})"
    cxexpr=f"{cx0:.2f}+({cx1-cx0:.2f})*min(1,on/{move})"
    cyexpr=f"{cy0:.2f}+({cy1-cy0:.2f})*min(1,on/{move})"
    xexpr=f"max(0,min(iw-iw/zoom,({cxexpr})-iw/(2*zoom)))"
    yexpr=f"max(0,min(ih-ih/zoom,({cyexpr})-ih/(2*zoom)))"
    pad=max(0,dur-src_available)
    filt=(f"[0:v]fps={FPS},zoompan=z='{zexpr}':x='{xexpr}':y='{yexpr}':d=1:fps={FPS}:s=430x932")
    if pad>0.01: filt += f",tpad=stop_mode=clone:stop_duration={pad:.3f}"
    filt += f",trim=duration={dur:.3f},setpts=PTS-STARTPTS,scale={SCREEN_W}:{SCREEN_H}[screen];"
    filt += f"[1:v]scale={W}:{H}[bg];[bg][screen]overlay={SCREEN_X}:{SCREEN_Y}:shortest=1[tmp];[tmp][2:v]overlay=0:0:shortest=1[out]"
    cmd=['ffmpeg','-loglevel','error','-y','-ss',f'{src_start:.3f}','-t',f'{max(0.05,src_available):.3f}','-i',str(capture),'-loop','1','-i',str(bg),'-loop','1','-i',str(frame),'-filter_complex',filt,'-map','[out]','-t',f'{dur:.3f}','-r',str(FPS),'-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-g','60',str(out)]
    sh(cmd)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--run',required=True); ap.add_argument('--voices',required=True); ap.add_argument('--music',required=True); ap.add_argument('--out',required=True); args=ap.parse_args()
    run=Path(args.run); voices=Path(args.voices); outdir=Path(args.out); outdir.mkdir(parents=True,exist_ok=True)
    manifest=json.load(open(run/'run.json'))
    starts={x['index']:sec(manifest['startedAt'],x['startedAt']) for x in manifest['timeline']}
    ends={x['index']:sec(manifest['startedAt'],x['finishedAt']) for x in manifest['timeline']}
    capture=run/'capture.webm'
    bg=outdir/'bg.png'; frame=outdir/'phone-frame.png'; rounded_gradient_bg(bg); phone_frame(frame)

    sections=[
      dict(name='hook',benefit='ONE MOBILE JOURNEY',subs=['What if a customer could choose a tour,','get answers, and move to booking','without jumping between chats, pages, and managers?','MAX TOUR puts the whole journey','into one clear mobile experience.'], beats=[
        (2,0.4,1.00,1.00,215,466,215,466),(2,2.6,1.00,1.12,215,466,215,245),(2,7.0,1.10,1.16,215,330,215,500),(3,0.0,1.06,1.00,215,500,215,466)]),
      dict(name='catalog',benefit='FASTER CHOICE',subs=['Tours, prices, and the key details','are visible immediately.','Customers compare options faster,','understand what fits them,','and need fewer repetitive answers from your team.'], beats=[
        (5,0.4,1.00,1.12,215,466,215,230),(5,4.0,1.10,1.16,215,280,215,500),(6,0.0,1.06,1.06,215,520,215,520),(7,1.0,1.04,1.14,215,520,215,590)]),
      dict(name='tour',benefit='FEWER QUESTIONS',subs=['Open a tour and the information','people usually ask a manager for','is already there: photos, itinerary,','format, price, and practical details.','Interest turns into a decision','while the customer is still engaged.'], beats=[
        (8,0.0,1.05,1.00,215,590,215,466),(9,0.8,1.00,1.14,215,466,215,250),(9,4.5,1.12,1.17,215,260,215,420),(10,0.0,1.06,1.06,215,520,215,520),(11,1.0,1.05,1.15,215,520,215,620)]),
      dict(name='choice',benefit='LESS FRICTION',subs=['Need a private option?','One tap takes the customer forward.','The next step is obvious,','so there is less friction','and less chance of losing the booking halfway through.'], beats=[
        (12,1.0,1.03,1.14,215,500,215,565),(13,0.0,1.10,1.10,215,560,215,560),(14,0.8,1.00,1.13,215,466,215,360),(14,5.0,1.10,1.16,215,400,215,600)]),
      dict(name='booking',benefit='CLEANER LEADS',subs=['Date, participants, transfer,','and contact details stay in one','structured booking flow.','Your manager receives a cleaner,','more prepared request instead of a scattered message thread.'], beats=[
        (15,0.0,1.05,1.05,215,520,215,520),(16,0.7,1.00,1.12,215,466,215,320),(16,4.0,1.10,1.16,215,360,215,540),(16,9.0,1.12,1.15,215,520,215,690)]),
      dict(name='ai',benefit='INSTANT ANSWERS',subs=['And when the customer has a question,','help is already inside the experience.','They ask the AI consultant normally,','get an immediate answer in context,','and keep moving toward the booking.'], beats=[
        (17,0.0,1.05,1.00,215,700,215,466),(19,0.5,1.00,1.12,215,466,215,500),(19,5.0,1.10,1.15,215,520,215,585),(20,0.0,1.12,1.10,215,580,215,520),(21,1.5,1.05,1.16,215,466,215,390)]),
      dict(name='value',benefit='MORE READY-TO-BUY CUSTOMERS',subs=['The result is simple:','faster decisions, fewer lost inquiries,','less repetitive communication,','and more customers reaching your team','already ready to buy.'], beats=[
        (7,4.0,1.10,1.15,215,560,215,590),(9,2.0,1.10,1.15,215,340,215,250),(16,2.0,1.08,1.14,215,430,215,560),(21,4.0,1.10,1.16,215,430,215,400),(2,5.0,1.08,1.12,215,350,215,500)]),
      dict(name='cta',benefit='BUILD YOUR VERSION',subs=['Want the same customer journey','for your tours?','VIIVERSION can adapt the system','to your products, processes, and sales channels.','Message us and we will show you your version.'], beats=[
        (2,1.0,1.00,1.10,215,466,215,260),(21,2.0,1.08,1.12,215,430,215,400),('cta',0,1,1,0,0,0,0)])
    ]

    voice_files=[voices/f"{s['name']}.mp3" for s in sections]
    durations=[probe(p) for p in voice_files]
    pre=0.6; gap=0.14; starts_out=[]; cur=pre
    for d in durations: starts_out.append(cur); cur += d+gap
    total=cur-gap+1.0
    write_ass(outdir/'captions.ass',sections,starts_out,durations,total)

    hero=outdir/'hero.png'
    sh(['ffmpeg','-loglevel','error','-y','-ss',f"{starts[2]+2:.3f}",'-i',str(capture),'-frames:v','1',str(hero)])
    cta_img=outdir/'cta-card.png'; make_cta_card(cta_img,hero)

    clips=[]
    all_beats=[]
    all_beats.append(dict(type='source',dur=pre,step=2,offset=0.2,z0=1,z1=1,cx0=215,cy0=466,cx1=215,cy1=466))
    for secobj,dur in zip(sections,durations):
        beats=secobj['beats']
        if secobj['name']=='cta':
            cta_card_dur=min(4.8,dur*0.48)
            source_dur=dur-cta_card_dur
            per=source_dur/2
            for b in beats[:2]:
                all_beats.append(dict(type='source',dur=per,step=b[0],offset=b[1],z0=b[2],z1=b[3],cx0=b[4],cy0=b[5],cx1=b[6],cy1=b[7]))
            all_beats.append(dict(type='cta',dur=cta_card_dur))
        else:
            per=dur/len(beats)
            for b in beats:
                all_beats.append(dict(type='source',dur=per,step=b[0],offset=b[1],z0=b[2],z1=b[3],cx0=b[4],cy0=b[5],cx1=b[6],cy1=b[7]))
        all_beats.append(dict(type='holdgap',dur=gap))
    all_beats.pop(); all_beats.append(dict(type='cta_hold',dur=1.0))

    last_source=None; idx=0
    for beat in all_beats:
        out=outdir/f'beat_{idx:03d}.mp4'; idx+=1
        if beat['type']=='source':
            st=beat['step']; src_start=min(ends[st]-0.08,starts[st]+beat['offset']); available=max(0.08,min(beat['dur'],ends[st]-src_start))
            render_beat(capture,bg,frame,out,src_start,available,beat['dur'],beat['z0'],beat['z1'],beat['cx0'],beat['cy0'],beat['cx1'],beat['cy1']); last_source=out
        elif beat['type']=='holdgap':
            sh(['ffmpeg','-loglevel','error','-y','-sseof','-0.05','-i',str(last_source),'-vf',f'tpad=stop_mode=clone:stop_duration={beat["dur"]:.3f},trim=duration={beat["dur"]:.3f},setpts=PTS-STARTPTS','-an','-r',str(FPS),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',str(out)])
        elif beat['type'] in ('cta','cta_hold'):
            img=cta_img; dur=beat['dur']
            sh(['ffmpeg','-loglevel','error','-y','-loop','1','-i',str(img),'-t',f'{dur:.3f}','-r',str(FPS),'-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',str(out)]); last_source=out
        clips.append(out)

    concat=outdir/'concat.txt'; concat.write_text('\n'.join([f"file '{p.as_posix()}'" for p in clips])+'\n')
    visual=outdir/'visual.mp4'; sh(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy',str(visual)])

    voice_mix=outdir/'voiceover.mp3'; cmd=['ffmpeg','-loglevel','error','-y']
    for p in voice_files: cmd += ['-i',str(p)]
    filters=[]; labels=[]
    for i,(st,d) in enumerate(zip(starts_out,durations)):
        delay=round(st*1000); filters.append(f'[{i}:a]aresample=44100,adelay={delay}:all=1[v{i}]'); labels.append(f'[v{i}]')
    filters.append(''.join(labels)+f'amix=inputs={len(labels)}:duration=longest:normalize=0,alimiter=limit=0.95[voice]')
    cmd += ['-filter_complex',';'.join(filters),'-map','[voice]','-c:a','libmp3lame','-b:a','192k',str(voice_mix)]
    sh(cmd)

    final=outdir/'MAX_TOUR_English_Dynamic_FINAL.mp4'
    fc=(f"[0:v]ass='{(outdir/'captions.ass').as_posix()}'[v];"
        f"[1:a]volume=0.16,atrim=duration={total:.3f},asetpts=N/SR/TB[m];"
        f"[m][2:a]sidechaincompress=threshold=0.045:ratio=8:attack=12:release=260[duck];"
        f"[duck][2:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]")
    sh(['ffmpeg','-loglevel','error','-y','-i',str(visual),'-stream_loop','-1','-i',str(args.music),'-i',str(voice_mix),'-filter_complex',fc,'-map','[v]','-map','[a]','-t',f'{total:.3f}','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(final)])
    for t in [1.5,12,25,39,54,67,78,total-2.5]:
        sh(['ffmpeg','-loglevel','error','-y','-ss',f'{t:.2f}','-i',str(final),'-frames:v','1',str(outdir/f'qa_{t:.1f}.png')])
    meta={'duration':probe(final),'voiceSeconds':sum(durations),'sections':[{'name':s['name'],'start':st,'duration':d,'benefit':s['benefit']} for s,st,d in zip(sections,starts_out,durations)]}
    (outdir/'render-report.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    print(json.dumps(meta,indent=2))

if __name__=='__main__': main()
