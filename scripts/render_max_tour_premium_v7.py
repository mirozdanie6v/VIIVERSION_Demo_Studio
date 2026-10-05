#!/usr/bin/env python3
import argparse, json, math, os, subprocess
from pathlib import Path
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W,H=1080,1920
FPS=30
TOP_ZONE_H=300
VIEW_X,VIEW_Y,VIEW_W,VIEW_H=180,320,720,1560
GRAPHITE=(8,8,9,255)
ORANGE=(255,158,82,255)

def sh(cmd):
    print("+", " ".join(map(str,cmd)), flush=True)
    subprocess.run(cmd, check=True)

def probe(path):
    return float(subprocess.check_output([
        "ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",str(path)
    ], text=True).strip())

def sec(iso0,iso):
    def p(x): return datetime.fromisoformat(x.replace("Z","+00:00"))
    return (p(iso)-p(iso0)).total_seconds()

def find_font(weight="regular"):
    preferred="Inter" if weight=="regular" else "Inter SemiBold"
    try:
        value=subprocess.check_output(["fc-match","-f","%{file}",preferred],text=True).strip()
        if value and Path(value).exists(): return value
    except Exception:
        pass
    return "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" if weight=="regular" else "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

FONT_REG=find_font("regular")
FONT_BOLD=find_font("bold")

def font(path,size):
    return ImageFont.truetype(path,size)

def make_bg(path):
    base=Image.new("RGBA",(W,H),GRAPHITE)
    glow=Image.new("RGBA",(W,H),(0,0,0,0))
    gd=ImageDraw.Draw(glow)
    gd.ellipse((-330,170,840,1390),fill=(255,128,52,38))
    gd.ellipse((460,1280,1220,2110),fill=(255,182,112,18))
    glow=glow.filter(ImageFilter.GaussianBlur(180))
    base=Image.alpha_composite(base,glow)

    noise=Image.effect_noise((W,H),18).convert("L")
    grain=Image.new("RGBA",(W,H),(255,255,255,0))
    grain.putalpha(noise.point(lambda p:max(0,min(18,int((p-128)*0.08+7)))))
    base=Image.alpha_composite(base,grain)

    d=ImageDraw.Draw(base)
    d.rectangle((0,0,W,TOP_ZONE_H),fill=(6,6,8,255))
    d.line((54,TOP_ZONE_H-1,W-54,TOP_ZONE_H-1),fill=(255,255,255,22),width=1)
    d.rounded_rectangle(
        (VIEW_X-12,VIEW_Y-12,VIEW_X+VIEW_W+12,VIEW_Y+VIEW_H+12),
        radius=34,fill=(14,14,16,235),outline=(255,255,255,24),width=2
    )
    base.save(path)

def make_clean_edge_bg():
    base=Image.new("RGBA",(W,H),GRAPHITE)
    glow=Image.new("RGBA",(W,H),(0,0,0,0))
    gd=ImageDraw.Draw(glow)
    gd.ellipse((-260,180,900,1380),fill=(255,128,52,38))
    gd.ellipse((430,1150,1210,2100),fill=(255,180,108,22))
    glow=glow.filter(ImageFilter.GaussianBlur(180))
    base=Image.alpha_composite(base,glow)
    noise=Image.effect_noise((W,H),16).convert("L")
    grain=Image.new("RGBA",(W,H),(255,255,255,0))
    grain.putalpha(noise.point(lambda p:max(0,min(14,int((p-128)*0.06+5)))))
    return Image.alpha_composite(base,grain)

def paste_phone(canvas, screenshot, box, radius=48):
    x,y,w,h=box
    d=ImageDraw.Draw(canvas)
    shadow=Image.new("RGBA",(W,H),(0,0,0,0))
    sd=ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x+8,y+18,x+w+8,y+h+22),radius=radius,fill=(0,0,0,155))
    shadow=shadow.filter(ImageFilter.GaussianBlur(28))
    canvas.alpha_composite(shadow)
    d=ImageDraw.Draw(canvas)
    d.rounded_rectangle((x,y,x+w,y+h),radius=radius,fill=(12,12,14,255),outline=(255,255,255,65),width=2)
    inset=12
    shot=Image.open(screenshot).convert("RGB").resize((w-2*inset,h-2*inset),Image.Resampling.LANCZOS)
    canvas.paste(shot,(x+inset,y+inset))
    d.rounded_rectangle((x+w//2-50,y+18,x+w//2+50,y+36),radius=10,fill=(3,3,4,245))

def make_intro(path, screenshot):
    canvas=make_clean_edge_bg()
    d=ImageDraw.Draw(canvas)
    d.text((72,112),"VIIVERSION  /  PRODUCT FILM",font=font(FONT_BOLD,18),fill=(255,255,255,145))
    d.text((72,250),"MAX TOUR",font=font(FONT_BOLD,72),fill="white")
    d.text((72,345),"One journey.",font=font(FONT_BOLD,46),fill=(245,245,245,244))
    d.text((72,405),"From discovery to confirmed payment.",font=font(FONT_BOLD,38),fill=(255,174,104,255))
    d.text((72,495),"Tours  ·  AI assistant  ·  Booking  ·  Payment",font=font(FONT_REG,25),fill=(225,225,228,188))
    paste_phone(canvas,screenshot,(335,690,410,888),48)
    d.text((72,1805),"MAX TOUR × VIIVERSION",font=font(FONT_BOLD,20),fill=(255,255,255,125))
    canvas.save(path)

def make_outro(path, screenshot):
    canvas=make_clean_edge_bg()
    d=ImageDraw.Draw(canvas)
    d.text((72,112),"VIIVERSION  /  RESULT",font=font(FONT_BOLD,18),fill=(255,255,255,145))
    d.rounded_rectangle((72,220,322,278),radius=28,fill=(255,147,70,245),outline=(255,183,118,255),width=1)
    d.text((197,249),"PAYMENT CONFIRMED",font=font(FONT_BOLD,18),fill=(255,255,255,255),anchor="mm")
    d.text((72,365),"Faster decisions.",font=font(FONT_BOLD,44),fill="white")
    d.text((72,430),"Cleaner bookings.",font=font(FONT_BOLD,44),fill="white")
    d.text((72,495),"More customers ready to buy.",font=font(FONT_BOLD,37),fill=(255,174,104,255))
    d.text((72,585),"Build your version with VIIVERSION.",font=font(FONT_REG,26),fill=(225,225,228,188))
    paste_phone(canvas,screenshot,(585,760,350,758),46)
    d.text((72,1805),"MAX TOUR × VIIVERSION",font=font(FONT_BOLD,20),fill=(255,255,255,125))
    canvas.save(path)

def extract_frame(video, time_s, out):
    sh(["ffmpeg","-loglevel","error","-y","-ss",f"{time_s:.3f}","-i",str(video),"-frames:v","1",str(out)])

def render_static(image,out,dur):
    sh([
        "ffmpeg","-loglevel","error","-y","-loop","1","-i",str(image),"-t",f"{dur:.3f}",
        "-r",str(FPS),"-an","-c:v","libx264","-preset","veryfast","-crf","19",
        "-pix_fmt","yuv420p",str(out)
    ])

def render_source(video,bg,out,start,end,dur):
    available=max(0.08,end-start)
    speed=max(1.0,available/max(0.08,dur))
    used=available/speed
    pad=max(0.0,dur-used)
    filt=(
        f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts=(PTS-STARTPTS)/{speed:.6f},"
        f"fps={FPS},scale={VIEW_W}:-2,crop={VIEW_W}:{VIEW_H}:0:(ih-{VIEW_H})/2,"
        f"eq=contrast=1.015:saturation=1.015,"
        f"tpad=stop_mode=clone:stop_duration={pad:.3f},trim=duration={dur:.3f},setpts=PTS-STARTPTS[ui];"
        f"[1:v]scale={W}:{H}[bg];[bg][ui]overlay={VIEW_X}:{VIEW_Y}:shortest=1[out]"
    )
    sh([
        "ffmpeg","-loglevel","error","-y","-i",str(video),"-loop","1","-i",str(bg),
        "-filter_complex",filt,"-map","[out]","-t",f"{dur:.3f}","-r",str(FPS),"-an",
        "-c:v","libx264","-preset","veryfast","-crf","19","-pix_fmt","yuv420p",str(out)
    ])

def render_payment(video,bg,out,dur):
    srcdur=probe(video)
    seg=min(srcdur,9.6)
    start=max(0.0,srcdur-seg)
    render_source(video,bg,out,start,srcdur,dur)

def concat_videos(clips,out):
    lst=Path(out).with_suffix(".txt")
    lst.write_text("\n".join([f"file '{Path(p).name}'" for p in clips])+"\n")
    sh(["ffmpeg","-loglevel","error","-y","-f","concat","-safe","0","-i",str(lst),"-c","copy",str(out)])

def ass_time(s):
    cs=max(0,round(s*100)); h=cs//360000; cs%=360000; m=cs//6000; cs%=6000
    return f"{h}:{m:02d}:{cs//100:02d}.{cs%100:02d}"

def wrap_two(text,limit=48):
    words=text.split(); lines=[]; cur=""
    for word in words:
        test=(cur+" "+word).strip()
        if not cur or len(test)<=limit: cur=test
        else: lines.append(cur); cur=word
    if cur: lines.append(cur)
    if len(lines)<=2: return r"\N".join(lines)
    mid=max(1,len(words)//2)
    return " ".join(words[:mid])+r"\N"+" ".join(words[mid:])

def write_ass(path,sections,starts,durations,payment_start,outro_start,outro_dur):
    header="""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Headline,Inter SemiBold,34,&H005CA6FF,&H005CA6FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,72,72,48,1
Style: Caption,Inter,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,76,76,118,1
Style: Outcome,Inter SemiBold,43,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,72,72,74,1
Style: OutcomeOrange,Inter SemiBold,43,&H005CA6FF,&H005CA6FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,72,72,74,1
Style: CTA,Inter,27,&H00D8D8DC,&H00D8D8DC,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,72,72,74,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events=[]
    for secobj,start,dur in zip(sections,starts,durations):
        end=start+min(1.35,dur)
        events.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Headline,,0,0,0,,{{\\fad(160,250)}}{secobj['headline']}")
        chunks=secobj["subs"]
        weights=[max(1,len(x.replace(" ",""))) for x in chunks]
        total=sum(weights); cur=start
        for i,(chunk,w) in enumerate(zip(chunks,weights)):
            nxt=start+dur if i==len(chunks)-1 else cur+dur*w/total
            events.append(f"Dialogue: 2,{ass_time(cur)},{ass_time(nxt)},Caption,,0,0,0,,{wrap_two(chunk)}")
            cur=nxt
    events.append(f"Dialogue: 3,{ass_time(payment_start)},{ass_time(payment_start+1.55)},Headline,,0,0,0,,{{\\fad(160,280)}}Payment confirmed.")

    # Outro copy is baked into the designed final frame; keep ASS overlays off it to avoid duplicate text.
    Path(path).write_text(header+"\n".join(events)+"\n",encoding="utf-8")

def build_voiceover(voices,starts,out):
    cmd=["ffmpeg","-loglevel","error","-y"]
    for p in voices: cmd += ["-i",str(p)]
    filters=[]; labels=[]
    for i,st in enumerate(starts):
        delay=round(st*1000)
        filters.append(f"[{i}:a]aresample=44100,adelay={delay}:all=1[v{i}]")
        labels.append(f"[v{i}]")
    filters.append("".join(labels)+f"amix=inputs={len(labels)}:duration=longest:normalize=0,alimiter=limit=0.95[voice]")
    cmd += ["-filter_complex",";".join(filters),"-map","[voice]","-c:a","pcm_s16le",str(out)]
    sh(cmd)

def make_sfx(out,total,section_starts,payment_start,confirm_time):
    cmd=["ffmpeg","-loglevel","error","-y","-f","lavfi","-i",f"anullsrc=r=44100:cl=stereo:d={total:.3f}"]
    filters=[]; labels=["[0:a]"]
    idx=1
    for t in section_starts[1:]:
        cmd += ["-f","lavfi","-i","anoisesrc=color=pink:duration=0.16:r=44100"]
        filters.append(f"[{idx}:a]highpass=f=900,lowpass=f=5200,volume=0.018,afade=t=out:st=0.06:d=0.10,adelay={round(t*1000)}:all=1[s{idx}]")
        labels.append(f"[s{idx}]"); idx+=1
    for t in [section_starts[1]+0.7,section_starts[3]+0.6,payment_start+0.35]:
        cmd += ["-f","lavfi","-i","sine=frequency=920:duration=0.055:sample_rate=44100"]
        filters.append(f"[{idx}:a]volume=0.025,afade=t=out:st=0.025:d=0.03,adelay={round(t*1000)}:all=1[s{idx}]")
        labels.append(f"[s{idx}]"); idx+=1
    for freq,offset,vol in [(880,0,0.045),(1320,115,0.032)]:
        cmd += ["-f","lavfi","-i",f"sine=frequency={freq}:duration=0.34:sample_rate=44100"]
        filters.append(f"[{idx}:a]volume={vol},afade=t=out:st=0.08:d=0.26,adelay={round(confirm_time*1000)+offset}:all=1[s{idx}]")
        labels.append(f"[s{idx}]"); idx+=1
    filters.append("".join(labels)+f"amix=inputs={len(labels)}:duration=longest:normalize=0,atrim=duration={total:.3f}[out]")
    cmd += ["-filter_complex",";".join(filters),"-map","[out]","-c:a","pcm_s16le",str(out)]
    sh(cmd)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--run",required=True)
    ap.add_argument("--voices")
    ap.add_argument("--music")
    ap.add_argument("--audio-master")
    ap.add_argument("--timing-report")
    ap.add_argument("--payment-video",required=True)
    ap.add_argument("--out",required=True)
    args=ap.parse_args()

    run=Path(args.run); out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    manifest=json.load(open(run/"run.json"))
    capture=run/"capture.webm"
    timeline=manifest["timeline"]
    starts_src={x["label"]:sec(manifest["startedAt"],x["startedAt"]) for x in timeline}
    ends_src={x["label"]:sec(manifest["startedAt"],x["finishedAt"]) for x in timeline}

    bg=out/"bg.png"; make_bg(bg)

    sections=[
      dict(name="hook",headline="One journey.",subs=[
        "Choose a tour, get answers, and move toward booking in one mobile experience.",
        "MAX TOUR keeps the whole customer journey clear and connected."
      ],src=("Establish home","Open catalog")),
      dict(name="catalog",headline="Find the right tour.",subs=[
        "Tours, prices and key details are visible immediately.",
        "Customers compare options faster and understand what fits them."
      ],src=("Establish catalog","Open Dalat Premium")),
      dict(name="tour",headline="Everything in context.",subs=[
        "Photos, itinerary, format, price and practical details stay together.",
        "Interest can turn into a decision while the customer is still engaged."
      ],src=("Establish tour","Read tour details")),
      dict(name="ai",headline="Ask naturally.",subs=[
        "A customer can describe what they want in ordinary language.",
        "The AI assistant answers in context and keeps the journey moving."
      ],src=("Open AI consultant","Read AI answer")),
      dict(name="choice",headline="Move forward.",subs=[
        "The next step stays obvious, with less friction between interest and booking.",
        "The customer returns to the tour and continues immediately."
      ],src=("Close AI consultant","Start booking")),
      dict(name="booking",headline="Book in one flow.",subs=[
        "Participants, hotel, traveler details and payment stay in one structured flow.",
        "The customer reaches confirmation without leaving the experience."
      ],src=("Establish booking","Show quote")),
    ]

    gap=0.10
    voice_files=[]
    if args.audio_master:
        if not args.timing_report:
            raise SystemExit("--timing-report is required with --audio-master")
        prior=json.load(open(args.timing_report))
        by_name={x["name"]:x for x in prior["sections"]}
        durations=[float(by_name[s["name"]]["duration"]) for s in sections]
        starts_out=[float(by_name[s["name"]]["start"]) for s in sections]
        content_end=float(prior["contentEnd"])
        outro_dur=float(prior.get("outroDuration",6.0))
        total=content_end+outro_dur
    else:
        if not args.voices or not args.music:
            raise SystemExit("--voices and --music are required unless --audio-master is supplied")
        voices_dir=Path(args.voices)
        voice_files=[voices_dir/f"{s['name']}.mp3" for s in sections]
        durations=[probe(p) for p in voice_files]
        starts_out=[]; cur=0.0
        for d in durations:
            starts_out.append(cur); cur+=d+gap
        content_end=cur-gap
        outro_dur=6.0
        total=content_end+outro_dur

    home_frame=out/"home.png"
    extract_frame(capture,starts_src["Establish home"]+0.25,home_frame)
    intro_img=out/"intro.png"; make_intro(intro_img,home_frame)

    paid_frame=out/"paid.png"
    extract_frame(Path(args.payment_video),max(0.0,probe(args.payment_video)-0.45),paid_frame)
    outro_img=out/"outro.png"; make_outro(outro_img,paid_frame)

    clips=[]
    payment_start=0.0
    for i,(section,dur) in enumerate(zip(sections,durations)):
        clip=out/f"section_{i:02d}.mp4"
        if section["name"]=="hook":
            intro_dur=min(2.6,dur*0.30)
            a=out/"hook_intro.mp4"; b=out/"hook_ui.mp4"
            render_static(intro_img,a,intro_dur)
            s0,e0=section["src"]
            render_source(capture,bg,b,starts_src[s0],ends_src[e0],dur-intro_dur)
            concat_videos([a,b],clip)
        elif section["name"]=="booking":
            payment_dur=min(6.8,dur*0.60)
            main_dur=dur-payment_dur
            a=out/"booking_ui.mp4"; b=out/"payment_ui.mp4"
            s0,e0=section["src"]
            render_source(capture,bg,a,starts_src[s0],ends_src[e0],main_dur)
            render_payment(Path(args.payment_video),bg,b,payment_dur)
            concat_videos([a,b],clip)
            payment_start=starts_out[i]+main_dur
        else:
            s0,e0=section["src"]
            render_source(capture,bg,clip,starts_src[s0],ends_src[e0],dur)
        clips.append(clip)
        if i<len(sections)-1:
            hold=out/f"gap_{i:02d}.mp4"
            sh(["ffmpeg","-loglevel","error","-y","-sseof","-0.04","-i",str(clip),
                "-vf",f"tpad=stop_mode=clone:stop_duration={gap:.3f},trim=duration={gap:.3f},setpts=PTS-STARTPTS",
                "-an","-r",str(FPS),"-c:v","libx264","-preset","veryfast","-crf","19","-pix_fmt","yuv420p",str(hold)])
            clips.append(hold)

    outro_clip=out/"outro.mp4"; render_static(outro_img,outro_clip,outro_dur); clips.append(outro_clip)
    visual=out/"visual.mp4"; concat_videos(clips,visual)

    ass=out/"captions.ass"
    write_ass(ass,sections,starts_out,durations,payment_start,content_end,outro_dur)

    final=out/"MAX_TOUR_Premium_Product_Film_v7_FINAL.mp4"
    if args.audio_master:
        fc=(
            f"[0:v]ass='{ass.as_posix()}'[v];"
            f"[1:a]atrim=duration={total:.3f},asetpts=N/SR/TB,alimiter=limit=0.95[a]"
        )
        sh([
            "ffmpeg","-loglevel","error","-y","-i",str(visual),"-i",str(args.audio_master),
            "-filter_complex",fc,"-map","[v]","-map","[a]",
            "-t",f"{total:.3f}","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p",
            "-c:a","aac","-b:a","192k","-movflags","+faststart",str(final)
        ])
    else:
        voiceover=out/"voiceover.wav"; build_voiceover(voice_files,starts_out,voiceover)
        sfx=out/"sound-design.wav"
        make_sfx(sfx,total,starts_out,payment_start,payment_start+min(5.8,durations[-1]*0.52))
        fc=(
            f"[0:v]ass='{ass.as_posix()}'[v];"
            f"[1:a]volume=0.115,atrim=duration={total:.3f},asetpts=N/SR/TB[m];"
            f"[m][2:a]sidechaincompress=threshold=0.035:ratio=9:attack=14:release=300[duck];"
            f"[duck][2:a][3:a]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95[a]"
        )
        sh([
            "ffmpeg","-loglevel","error","-y","-i",str(visual),"-stream_loop","-1","-i",str(args.music),
            "-i",str(voiceover),"-i",str(sfx),"-filter_complex",fc,"-map","[v]","-map","[a]",
            "-t",f"{total:.3f}","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p",
            "-c:a","aac","-b:a","192k","-movflags","+faststart",str(final)
        ])

    qa_times=[1.5,starts_out[1]+1.0,starts_out[2]+1.0,starts_out[3]+2.0,starts_out[4]+1.0,payment_start+2.0,content_end+3.0]
    for t in qa_times:
        sh(["ffmpeg","-loglevel","error","-y","-ss",f"{t:.2f}","-i",str(final),"-frames:v","1",str(out/f"qa_{t:.1f}.png")])

    report={
        "duration":probe(final),
        "contentEnd":content_end,
        "outroDuration":outro_dur,
        "paymentStart":payment_start,
        "sections":[{"name":s["name"],"headline":s["headline"],"start":st,"duration":d} for s,st,d in zip(sections,starts_out,durations)],
        "visualLanguage":{
            "mainLayout":"full-mobile-viewport-below-top-subtitle-zone",
            "subtitleZone":"top-graphite",
            "subtitleZoneHeightPx":TOP_ZONE_H,
            "subtitleMaxLines":2,
            "deviceFrames":["intro","outro"],
            "palette":"graphite + warm orange",
            "cursor":"hidden",
            "camera":"semantic establish-focus-resolve",
            "soundDesign":["tap","transition","confirmation chime"],
        }
    }
    (out/"render-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    main()
