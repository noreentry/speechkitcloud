var speex_loaded = false;
var recLength = 0,
  recBuffersL = [],
  recBuffersR = [],
  sampleRate,
  outSampleRate;
var tmp_buf = 0;
var need_buf_size = 4096;
var speex_converter = null;

this.onmessage = function(e){
  switch(e.data.command){
    case 'init':
      init(e.data.config);
      break;
    case 'record':
      record(e.data.buffer);
      break;
    case 'exportWAV':
      exportWAV(e.data.type);
      break;
    case 'exportMonoWAV':
      exportMonoWAV(e.data.type);
      break;
    case 'getBuffers':
      getBuffers();
      break;
    case 'clear':
      clear();
      break;
  }
};

function init(config){
  sampleRate = config.sampleRate;
  outSampleRate = config.format.samplerate || sampleRate;
  need_buf_size = config.bufSize || 4096;
  speex_converter = null;
  if (config.format.format == "speex") {
        if (!speex_loaded) {
            importScripts("./speex.min.js"); 
            speex_loaded = true;
        }
        need_buf_size /= 16;
        speex_converter = new SpeexConverter(outSampleRate);
  }
}

function record(inputBuffer){
    if (outSampleRate == sampleRate) {
        recBuffersL.push(inputBuffer[0]);
        recBuffersR.push(inputBuffer[1]);
        recLength += inputBuffer[0].length;

        var samples = inputBuffer[0];
        var buffer = new ArrayBuffer(samples.length * 2);
        var view = new DataView(buffer);
        floatTo16BitPCM(view, 0, samples);
        this.postMessage({command: 'int16stream', buffer: buffer});
    }
    else
    {
        function resample(inbuf) {
            var result = new Float32Array(Math.floor(inbuf.length*outSampleRate/sampleRate));
            var bin = 0,
            num = 0,
            indexIn = 0,
            indexOut = 0;
            while (indexIn < result.length) {
                bin = 0;
                num = 0;
                while (indexOut < Math.min(inbuf.length, (indexIn + 1) * sampleRate/outSampleRate)) {
                    bin += inbuf[indexOut];
                    num += 1;
                    indexOut++;
                }
                result[indexIn] = bin / num;
                indexIn++;
            }
            return result;
        }
        
        var resin0 = resample(inputBuffer[0]);
        var resin1 = resample(inputBuffer[1]);

        recBuffersL.push(resin0);
        recBuffersR.push(resin1);
        recLength += resin0.length;

        var result = new Int16Array(resin0.length);

        for (var i = 0 ; i < resin0.length ; i++) {
            result[i] = Math.ceil((resin0[i] + resin1[i]) * 16383);
        }
        result = result;

        if (speex_converter)
            result = speex_converter.convert(result);
        else
            result = result.buffer;
      
        if (!tmp_buf) {
            tmp_buf = result;
        }
        else {
            var tmp = new DataView(new ArrayBuffer(tmp_buf.byteLength + result.byteLength));
            tmp_buf = new DataView(tmp_buf);
            result = new DataView(result);

            for (var i=0; i<tmp_buf.byteLength; i++)
                tmp.setUint8(i, tmp_buf.getUint8(i));
        
            for (var i=0; i<result.byteLength; i++)
                tmp.setUint8(i+tmp_buf.byteLength, result.getUint8(i));

            tmp_buf = tmp.buffer;
        }
        

        if (tmp_buf.byteLength >= need_buf_size) {
            this.postMessage({command: 'int16stream', buffer: tmp_buf});
            tmp_buf = false;
        }
    }
}

function exportWAV(type){
  var bufferL = mergeBuffers(recBuffersL, recLength);
  var bufferR = mergeBuffers(recBuffersR, recLength);
  var interleaved = interleave(bufferL, bufferR);
  var dataview = encodeWAV(interleaved);
  var audioBlob = new Blob([dataview], { type: type });

  this.postMessage({command: 'exportWAV', blob: audioBlob});
}

function exportMonoWAV(type){
  var bufferL = mergeBuffers(recBuffersL, recLength);
  var dataview = encodeWAV(bufferL, true);
  var audioBlob = new Blob([dataview], { type: type });

  this.postMessage({command: 'exportMonoWAV', blob: audioBlob});
}

function getBuffers() {
  var buffers = [];
  buffers.push( mergeBuffers(recBuffersL, recLength) );
  buffers.push( mergeBuffers(recBuffersR, recLength) );
  this.postMessage({command: 'getBuffers', blob: buffers});
}

function clear(){
  recLength = 0;
  recBuffersL = [];
  recBuffersR = [];
  if (speex_converter)
    speex_converter.clear();
  this.postMessage({command: 'clear'});
}

function mergeBuffers(recBuffers, recLength){
  var result = new Float32Array(recLength);
  var offset = 0;
  for (var i = 0; i < recBuffers.length; i++){
    result.set(recBuffers[i], offset);
    offset += recBuffers[i].length;
  }
  return result;
}

function interleave(inputL, inputR){
  var length = inputL.length + inputR.length;
  var result = new Float32Array(length);

  var index = 0,
    inputIndex = 0;

  while (index < length){
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function floatTo16BitPCM(output, offset, input){
  for (var i = 0; i < input.length; i++, offset+=2){
    var s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view, offset, string){
  for (var i = 0; i < string.length; i++){
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWAV(samples, mono){
  var buffer = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 32 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, mono?1:2, true);
  /* sample rate */
  view.setUint32(24, outSampleRate, true);
  
  /* block align (channel count * bytes per sample) */
  var block_align = mono?2:4;
  /* byte rate (sample rate * block align) */
  view.setUint32(28, outSampleRate * block_align, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, block_align, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);

  return view;
}
