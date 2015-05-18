/*
 * THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
 * IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

'use strict';

var fse = require('fs-extra');
var fs = require('fs');
var logger = require('bunyan').createLogger({name: 'rocker-container'});
var executor = require('nscale-util').executor();
var docker = require('./docker');
var commands = require('./platform').commands;
var p = require('path');



/**
 * docker specific build process
 */
module.exports = function(config, platform) {


  /**
   * check that docker is able to run on this system
   */
  var preCheck = function() {
    var stat = fs.existsSync('/var/run/docker.sock');
    if (!stat) {
      stat = process.env.DOCKER_HOST || false;
    }
    return stat;
  };

  var generateTargetPath = function(system, options, containerDef) {
    var re = /.*?\/([^\/]*?)\.git/i;
    var rpath = re.exec(containerDef.specific.repositoryUrl);
    var result = p.join(system.repoPath, 'workspace', containerDef.specific.checkoutDir || rpath[1]);
    console.log('RESULT', result);
    return result;
  };

  var createImage = function(mode, system, containerDef, targetPath, out, cb) {
    var cmds = commands(platform);
    var path = process.cwd();

    if (containerDef.specific.repositoryUrl) {
      path = generateTargetPath(system, config, containerDef);
    }

    path = path + '/';

    out.stdout('creating image');
    logger.info('creating image');

    // BEGIN

    var script;

    if(containerDef.specific.commit) {
      script = [        
        'git checkout -q ' + containerDef.specific.commit, // checkout the specific commit, silently
        'echo checked out ' + containerDef.specific.commit, // give some output to the user
        'mkdir -p layout/rootfs',
        'ls -1a | grep -Ev "^(.git|\\.{1,2}$|layout$)" | xargs -I{} mv {} layout/rootfs',
        'cd layout/rootfs',
        'mv manifest ..',
        'cd ../..',
        'actool build layout image.aci', // building!
        'rkt --insecure-skip-verify fetch image.aci', // store image
        'RESULT=$?', // cache the build result
        'git reset --hard HEAD', // reset any changes we did to the repo
        'rm -rf image.aci layout', // clear
        '(exit $RESULT)' //  exit
      ].join(' && ');
    } else {
      script = 'rkt fetch ' + containerDef.specific.name + ' && ' + 
        'docker tag -f ' + containerDef.specific.name + ' ' + tag;
    }

    logger.debug('rocket build script: ' + script);
    executor.exec(mode, script, path + targetPath, out, function(err) {
      if (err) {
        return cb(err);
      }

      out.progress('created image');
      cb();

      // TODO: push to registry

      // out.progress('pushing to registry');
      // script = cmds.generatePushScript(config, system, containerDef);
      // logger.debug('docker push script: ' + script);

      // executor.exec(mode, script, path + targetPath, out, function(err) {
      //   if (err) {
      //     return cb(err);
      //   }

      //   out.progress('created image');
      //   cb();
      // });

    });

    // END
  };



  var build = function(mode, system, containerDef, out, cb) {
    var path;

    if (preCheck()) {
      if (containerDef.specific.buildScript) {
        path = generateTargetPath(system, config, containerDef);
        logger.info('running build script: sh ./' + containerDef.specific.buildScript);
        out.progress('running build script: ./' + containerDef.specific.buildScript);
        executor.exec(mode, 'sh ./' + containerDef.specific.buildScript, path, out, function(err, targetPath) {
          if (err) {
            return cb(err);
          }

          createImage(mode, system, containerDef, targetPath, out, cb);
        });
      }
      else {
        logger.info('no build script present, skipping');
        createImage(mode, system, containerDef, '.', out, cb);
      }
    }
    else {
      cb('docker precheck failed, please enusure that docker can run on this system', null);
    }
  };



  return {
    build: build,
  };
};

